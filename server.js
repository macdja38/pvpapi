/**
 * Created by macdja38 on 2017-01-13.
 */
const express = require('express');
const http = require('http');
const url = require('url');
const WebSocket = require('ws');

const OpCodes = require('./OpCodes');

const auth = require('./config/auth.json');

const r = require('rethinkdbdash')(auth.rethinkdb);

function ensure(r, tableName) {
  r.tableList().contains(tableName)
    .do(function(databaseExists) {
      return r.branch(
        databaseExists,
        { table_created: 0 },
        r.tableCreate(tableName)
      );
    }).run();
}

ensure(r, "settingsBot");
ensure(r, "settingsMap");
ensure(r, "settings");

const app = express();

app.use(function (req, res) {
  res.send({ msg: "hello" });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

class Client {
  constructor(ws, id) {
    this.ws = ws;
    this.id = id;
    this.guildSet = false;
    this.incomingMessage = this.incomingMessage.bind(this);
    this.send = this.send.bind(this);
    this.send({op: OpCodes.HELLO,
      d: {
      heartbeat_interval: 15000
    }});
    ws.on("message", this.incomingMessage);
  }

  incomingMessage(message) {
    let contents = JSON.parse(message);
    console.log('received ', contents, message);
    switch (contents.op) {
      case OpCodes.IDENTIFY:
        this.send({
          op: OpCodes.DISPATCH,
          t: "READY",
        });
        break;
      case OpCodes.REQUEST_GUILD:
        let newGuildList = contents.d.guilds.map(g => `${this.id}|${g}`);
        console.log(JSON.stringify(newGuildList));
        if (!this.guildSet) {
          this.guildSet = new Set(newGuildList)
        } else {
          newGuildList.forEach(guildIdentifier => {
            this.guildSet.add(guildIdentifier);
          })
        }
        let settingsTable = r.table('settings');
        settingsTable.getAll(...newGuildList).run().then((values) => {
            values.forEach((value) => {
                value.id = value.id.split("|")[1];
                this.send({
                    op: OpCodes.DISPATCH,
                    t: "GUILD_CONFIG_UPDATE",
                    d: value ,
                });
            })
        });
        settingsTable
          .getAll(...this.guildSet, { index: 'id' })
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
                d: parsedData ,
              });
            })
          });
        break;
      case OpCodes.UPDATE_CONFIG:
        contents.d.data.id = `${this.id}|${contents.d.id}`;
        r.table('settingsMap').insert(contents.d.data, {conflict: contents.d.o}).run();
        break;
    }
  }

  send(object) {
    this.ws.send(JSON.stringify(object));
  }
}

wss.on('connection', handleConnection);

function handleConnection(ws) {
  let headers = ws.upgradeReq.headers;
  console.log('connection?', headers);
  if (headers.token && headers.id) {
    r.table("settingsBot").get(headers.id).then((settings) => {
      if (settings !== null) {
        if (settings.token === headers.token) {
          return new Client(ws, headers.id);
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