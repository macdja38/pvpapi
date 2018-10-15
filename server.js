/**
 * Created by macdja38 on 2017-01-13.
 */
const express = require('express');
const http = require('http');
const url = require('url');
const WebSocket = require('ws');

const OpCodes = require('./OpCodes');

const auth = require('./config/auth.json');

const r = require("./db");
const accessChecks = require("./accessChecks");

let clients = [];

function ensure(r, tableName) {
  r.tableList().contains(tableName)
    .do(function (databaseExists) {
      return r.branch(
        databaseExists,
        {table_created: 0},
        r.tableCreate(tableName),
      );
    }).run();
}

ensure(r, "settingsBot");
ensure(r, "settingsMap");
ensure(r, "settings");

const app = express();

let currentRequets = {};

app.get('/v1/settingsMap/:id/', accessChecks.checkPvPClientAccessingOwnDataIDInParams, (req, res) => {
  r.table("settingsMap").get(`${req.params.id}|*`).then(settings => {
    if (settings == null) {
      res.status(403).send("Client config not found")
    } else {
      res.json(settings);
    }
  })
});

app.get('/v1/server/:id/', (req, res) => {
  let clientID = req.headers.id;
  if (!clientID) {
    res.status(400).send("id header not present, please supply the bot id.")
  }
  r.table("settingsBot").get(clientID).run().then((settings) => {
    if (settings === null || settings.token !== req.headers.token) {
      return res.rejectUnauthorized();
    }
    let possibleClients = clients.filter(c => c.id === clientID).filter(c => c.guildSet && c.guildSet.has(clientID + "|" + req.params.id));
    if (possibleClients.length > 0) {
      let client = possibleClients[0];
      let nonce = Math.random() * 100000;
      client.send({
        op: OpCodes.GET_CHANNELS_USERS_AND_ROLES,
        nonce: nonce,
        d: {id: req.params.id},
      });
      (new Promise((resolve, reject) => {
        currentRequets[nonce] = {resolve, reject}
      })).then(data => res.json({data})).catch((error) => res.status(500).send(error.toString()));
      setTimeout(() => {
        if (currentRequets.hasOwnProperty(nonce)) {
          currentRequets[nonce].reject("Timed out");
          delete currentRequets[nonce];
        }
      }, 5000)
    } else {
      res.status(404).send("guild with that id was not currently available");
    }
  });
});

app.use(function (req, res) {
  res.send({msg: "hello"});
});

const server = http.createServer(app);
const wss = new WebSocket.Server({server});

class Client {
  constructor(ws, id) {
    this.ws = ws;
    this.id = id;
    this.guildSet = false;
    this.incomingMessage = this.incomingMessage.bind(this);
    this.onClose = this.onClose.bind(this);
    this.send = this.send.bind(this);
    this.send({
      op: OpCodes.HELLO,
      d: {
        heartbeat_interval: 15000,
      },
    });
    ws.on("message", this.incomingMessage);
    ws.once("close", this.onClose);
  }

  onClose() {
    this.ws.removeListener("message", this.incomingMessage);
    let index = clients.indexOf(this);
    clients.splice(index, 1);
  }

  incomingMessage(message) {
    let contents = JSON.parse(message);
    switch (contents.op) {
      case OpCodes.IDENTIFY: {
        this.send({
          op: OpCodes.DISPATCH,
          t: "READY",
        });
        break;
      }
      case OpCodes.REMOVE_GUILD: {
        const removeGuildList = contents.d.guilds.map(g => `${this.id}|${g}`);
        if (!this.guildSet) return;
        removeGuildList.forEach(guildIdentifier => this.guildSet.delete(guildIdentifier));
        break;
      }
      case OpCodes.REQUEST_GUILD: {
        const newGuildList = contents.d.guilds.map(g => `${this.id}|${g}`);
        if (!this.guildSet) {
          this.guildSet = new Set(newGuildList);
        } else {
          newGuildList.forEach(guildIdentifier => this.guildSet.add(guildIdentifier));
        }
        let settingsTable = r.table('settings');
        settingsTable.getAll(...newGuildList).run().then((values) => {
          values.forEach((value) => {
            value.id = value.id.split("|")[1];
            this.send({
              op: OpCodes.DISPATCH,
              t: "GUILD_CONFIG_UPDATE",
              d: value,
            });
          })
        });
        settingsTable
          .getAll(...this.guildSet, {index: 'id'})
          .changes({
            squash: true,
          })
          .run((err, cursor) => {
            if (err) {
              console.log(err);
              return;
            }
            if (this.cursor) {
              this.cursor.close();
            }
            this.cursor = cursor;
            cursor.each((error, value) => {
              if (error) {
                console.error(error);
                return;
              }
              const parsedData = value.new_val;
              parsedData.id = parsedData.id.split("|")[1];
              this.send({
                op: OpCodes.DISPATCH,
                t: "GUILD_CONFIG_UPDATE",
                d: parsedData,
              });
            })
          });
        break;
      }
      case OpCodes.UPDATE_CONFIG: {
        contents.d.data.id = `${this.id}|${contents.d.id}`;
        r.table('settingsMap').insert(contents.d.data, {conflict: contents.d.o}).run();
        break;
      }
      case OpCodes.RESPONSE_CHANNELS_USERS_AND_ROLES: {
        if (currentRequets.hasOwnProperty(contents.nonce)) {
          currentRequets[contents.nonce].resolve(contents.d);
          delete currentRequets[contents.nonce];
        }
      }
    }
  }

  send(object) {
    return this.ws.send(JSON.stringify(object));
  }
}

wss.on('connection', handleConnection);

function handleConnection(ws, { headers }) {
  console.log('connection?', headers);
  if (headers.token && headers.id) {
    r.table("settingsBot").get(headers.id).then((settings) => {
      if (settings !== null) {
        if (settings.token === headers.token) {
          let client = new Client(ws, headers.id);
          clients.push(client);
          return client;
        }
      }
      ws.terminate(403);
    })
  } else {
    ws.terminate(403)
  }
}

server.listen(auth.port, function listening() {
  console.log('Listening on %d', server.address().port);
});