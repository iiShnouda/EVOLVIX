import http from 'node:http';
let calls = 0;
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'fake-mini' }] }));
    calls++;
    const user = JSON.parse(JSON.parse(body).messages[1].content);
    const items = user.items.map((t) => (user.to === 'Arabic' ? `ع ${t}` : `E ${t}`));
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items }) } }] }));
  });
}).listen(5099, () => console.log('fake ai on 5099'));
