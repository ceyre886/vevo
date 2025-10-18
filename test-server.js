const http = require('http');
http.createServer((req, res) => {
  res.end('Node test server working!');
}).listen(8080, () => console.log('Listening on port 8080'));
