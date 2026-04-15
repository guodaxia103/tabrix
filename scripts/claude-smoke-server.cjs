const http = require('http');
const fs = require('fs');
const path = require('path');
const port = 62100;
const html = `<!doctype html><html><head><meta charset='utf-8'><title>Tabrix Claude Smoke</title></head><body>
<h1 id='title'>Tabrix Claude Smoke</h1>
<button id='clickBtn' onclick="document.getElementById('clickOut').textContent='clicked'">Click me</button>
<span id='clickOut'></span>
<input id='textInput' placeholder='type here' />
<select id='selectInput'><option value='a'>A</option><option value='b'>B</option></select>
<input id='checkInput' type='checkbox' />
<button id='alertBtn' onclick="alert('hello-alert')">Alert</button>
<button id='promptBtn' onclick="document.getElementById('promptOut').textContent='pending';setTimeout(()=>{const v=prompt('Enter value','default');document.getElementById('promptOut').textContent=v||'';},50);">Prompt</button>
<span id='promptOut'></span>
<input id='fileInput' type='file' />
<a id='downloadTxt' href='/download.txt' download='download-source.txt'>Download txt</a>
<a id='page2' href='/page2.html'>Go page 2</a>
<script>console.log('smoke-page-loaded');</script>
</body></html>`;
const page2 = `<!doctype html><html><head><meta charset='utf-8'><title>Page2</title></head><body><h2 id='p2'>Page 2</h2></body></html>`;
const server = http.createServer((req,res)=>{
  if(req.url === '/' || req.url.startsWith('/index')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;}
  if(req.url === '/page2.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(page2);return;}
  if(req.url === '/download.txt'){res.writeHead(200,{'Content-Type':'text/plain','Content-Disposition':'attachment; filename="download-source.txt"'});res.end('tabrix-download-content');return;}
  if(req.url === '/json'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,ts:Date.now()}));return;}
  res.writeHead(404);res.end('not found');
});

function shutdown(signal) {
  server.close(() => {
    console.log(`smoke server stopped (${signal})`);
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.listen(port,'127.0.0.1',()=>console.log(`smoke server running at http://127.0.0.1:${port}`));
