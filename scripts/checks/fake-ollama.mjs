import http from 'node:http';
const log = [];
http
  .createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const send = (o) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(o));
    };
    if (req.url === '/api/tags')
      return send({ models: [{ name: 'qwen2.5:7b-instruct' }, { name: 'qwen2.5vl:7b' }] });
    if (req.url === '/api/chat') {
      const b = JSON.parse(body);
      const last = b.messages[b.messages.length - 1];
      if (b.format === 'json') {
        const p = b.messages[0].content;
        if (p.includes('supplier invoice'))
          return send({
            message: {
              role: 'assistant',
              content: JSON.stringify({
                supplierName: 'Courier2',
                number: 'F-77',
                date: '2026-10-05',
                lines: [
                  {
                    name: 'ادم فنيله ريجالي نص كم M',
                    quantity: '12',
                    unitPrice: '٤٥',
                    discount: 0,
                  },
                  { name: 'شراب قطن', quantity: 24, unitPrice: '15.5', discount: '1' },
                ],
              }),
            },
          });
        return send({
          message: {
            role: 'assistant',
            content:
              '```json\n' +
              JSON.stringify({
                cheques: [
                  {
                    serial: '000123',
                    amount: '5,000',
                    dueDate: '2026-11-01',
                    bank: 'CIB',
                    drawer: 'Al-Nour',
                  },
                  {
                    serial: '000124',
                    amount: 5000,
                    dueDate: '2026-12-01',
                    bank: 'CIB',
                    drawer: 'Al-Nour',
                  },
                ],
              }) +
              '\n```',
          },
        });
      }
      const tools = (b.tools ?? []).map((t) => t.function.name);
      if (last.role === 'user') {
        log.push({ q: last.content, tools });
        if (/رصيد|balance/i.test(last.content) && tools.includes('find_party'))
          return send({
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{ function: { name: 'find_party', arguments: { query: 'Al-Nour' } } }],
            },
          });
        if (/مبيعات|sales/i.test(last.content) && tools.includes('sales_summary'))
          return send({
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  function: {
                    name: 'sales_summary',
                    arguments: { from: '2026-10-01', to: '2026-10-31' },
                  },
                },
              ],
            },
          });
        return send({ message: { role: 'assistant', content: 'TOOLS:' + tools.join(',') } });
      }
      if (last.role === 'tool')
        return send({ message: { role: 'assistant', content: 'RESULT: ' + last.content } });
    }
    res.writeHead(404);
    res.end();
  })
  .listen(11434, '127.0.0.1', () => console.log('fake ollama up'));
