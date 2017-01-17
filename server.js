/**
 * Created by macdja38 on 2017-01-13.
 */
const express = require('express');
const http = require('http');
const url = require('url');
const WebSocket = require('ws');

const OpCodes = require('./OpCodes');

const r = require('rethinkdbdash')({
  port: '28015',
  host: 'localhost',
  db: 'tau'
});

const app = express();

app.use(function (req, res) {
  res.send({ msg: "hello" });
});

let clientId = "38383838338";

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', function connection(ws) {
  console.log('connection?');
  const location = url.parse(ws.upgradeReq.url, true);
  console.log('location', location);
  // You might use location.query.access_token to authenticate or share sessions
  // or ws.upgradeReq.headers.cookie (see http://stackoverflow.com/a/16395220/151312)

  ws.on('message', function incoming(message) {
    let contents = JSON.parse(message);
    console.log('received ', contents, message);
    switch (contents.op) {
      case OpCodes.IDENTIFY:
        ws.send(JSON.stringify({
          op: OpCodes.DISPATCH,
          t: "READY",
        }));
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
              ws.send(JSON.stringify({
                op: OpCodes.DISPATCH,
                t: "GUILD_CONFIG_UPDATE",
                d: parsedData ,
              }))
            })
          });
        break;
    }
  });

  ws.send(JSON.stringify({
    op: OpCodes.HELLO,
    d: {
      heartbeat_interval: 15000
    }
  }));
});

server.listen(8080, function listening() {
  console.log('Listening on %d', server.address().port);
});