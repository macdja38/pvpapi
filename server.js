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

let clientId = "38383838338";

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

class Client {
  constructor(ws, id) {
    this.ws = ws;
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
        console.log(JSON.stringify(contents.d.guilds.map(g => `${clientId}|${g}`)));
        r
          .table('settings')
          .getAll(...contents.d.guilds.map(g => `${clientId}|${g}`), { index: 'id' })
          .changes({
            squash: true,
            includeInitial: true,
          })
          .run((err, cursor) => {
            cursor.each((error, value) => {
              console.log(value.new_val);
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

server.listen(8089, function listening() {
  console.log('Listening on %d', server.address().port);
});