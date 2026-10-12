// Runs google-sheet/Code.gs on this computer as a pretend Google web app, for testing the site.
// Usage: node tests/sheet_mock_server.js <port> <passphrase> [path/to/Code.gs]
// Then connect the site to http://localhost:<port>/exec with that passphrase.
// GET /__offline/on and /__offline/off make it refuse requests, to test "can't reach the sheet".
const http = require('http');
const path = require('path');
const {load} = require('./sheet_mock');

const [port = '8771', pass = 'local-test', code = path.join(__dirname, '..', 'google-sheet', 'Code.gs')] = process.argv.slice(2);
const app = load(code, pass);
let offline = false;

http.createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'});
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  if (req.url === '/__offline/on') { offline = true; return send(200, {offline}); }
  if (req.url === '/__offline/off') { offline = false; return send(200, {offline}); }
  if (req.url === '/__rows') {
    const sh = app.sheets.Trades;
    return send(200, sh ? sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), sh.getLastColumn() || 1).getValues() : []);
  }
  if (!req.url.startsWith('/exec')) return send(404, {ok: false});
  if (offline) { req.socket.destroy(); return; }               // looks like a network failure
  if (req.method === 'GET') return send(200, app.get());
  if (req.method !== 'POST') return send(405, {ok: false});
  let body = '';
  req.on('data', c => { body += c; if (body.length > 2e6) req.socket.destroy(); });
  req.on('end', () => setTimeout(() => send(200, app.call(body)), 300));   // a little delay, like Google
}).listen(+port, '127.0.0.1', () => console.log(`pretend sheet web app on http://localhost:${port}/exec`));
