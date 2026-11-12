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
    // What the app sent (system prompts, recordings' settings, text to read aloud), for the tests.
    if (req.url === '/__log') return send(log);
    // The speech service (whisper-asr-webservice), when the app is pointed here for it too.
    if (req.url === '/docs') return send({ ok: true });
    // The voice (Piper, apps/voice), when the app is pointed here for it too.
    if (req.url === '/health') return send({ ar: true, en: true, memoryBytes: 90000000, diskBytes: 130000000 });
    if (req.url === '/speak') {
      log.push({ speak: JSON.parse(body) });
      res.writeHead(200, { 'content-type': 'audio/wav' });
      return res.end(Buffer.from('RIFF0000WAVEfmt '));
    }
    if (req.url?.startsWith('/asr')) {
      log.push(['asr', req.url, req.headers['content-type'] ?? '', body.length]);
      return send({ text: ' كم رصيد النور؟ ', language: 'ar' });
    }
    if (req.url === '/api/tags')
      return send({
        models: [
          { name: 'qwen2.5:7b-instruct', size: 4683087332 },
          { name: 'qwen2.5vl:7b', size: 5969245856 },
        ],
      });
    if (req.url === '/api/ps')
      return send({ models: [{ name: 'qwen2.5:7b-instruct', size: 5600000000 }] });
    if (req.url === '/api/chat') {
      const b = JSON.parse(body);
      const last = b.messages[b.messages.length - 1];
      if (b.format === 'json') {
        const p = b.messages[0].content;
        // A stocktake sheet: counts beside printed codes, one in Arabic-Indic digits, one unknown code.
        if (p.includes('stock count sheet'))
          return send({
            message: {
              role: 'assistant',
              content: JSON.stringify({
                lines: [
                  { code: 'PKG-001', counted: 200 },
                  { code: 'CLN-001', counted: '١٠٠' },
                  { code: 'ZZZ-999', counted: 3 },
                ],
              }),
            },
          });
        if (p.includes("supplier's invoice"))
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
        // Handwritten Egyptian cheques (the photo carries the marker CHEQUE-AR): figures misread
        // against the words, Arabic-Indic digits, day-first dates, a month written out, an
        // impossible day and a date long past.
        const photo = Buffer.from(b.messages[0].images?.[0] ?? '', 'base64').toString('latin1');
        if (photo.includes('CHEQUE-AR'))
          return send({
            message: {
              role: 'assistant',
              content: JSON.stringify({
                cheques: [
                  {
                    serial: '٠٠٠٤٥٦',
                    amount: '٣٠٠٠٠',
                    amountWords: 'فقط خمسة وثلاثون ألف جنيه مصري لا غير',
                    date: '١٥/٣/٢٠٢٧',
                    bank: 'البنك الأهلي المصري',
                    drawer: 'النور',
                  },
                  {
                    serial: '457',
                    amount: '12,500',
                    amountWords: 'Twelve thousand five hundred Egyptian pounds only',
                    date: '5 مارس 2027',
                    bank: 'CIB',
                    drawer: 'Al-Nour',
                  },
                  {
                    serial: null,
                    amount: 4000,
                    amountWords: 'أربعة آلاف وخمسمائة جنيه و خمسون قرشا',
                    date: '3/15/2027',
                    bank: null,
                    drawer: null,
                  },
                  {
                    serial: '459',
                    amount: '٢٠٠٠',
                    amountWords: null,
                    date: '01/02/2019',
                    bank: 'CIB',
                    drawer: null,
                  },
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
      const system = b.messages[0].content;
      // The app asks for an answer in the wrong language to be written again.
      if (system.startsWith('Rewrite')) {
        log.push({ rewrite: system });
        return send({
          message: {
            role: 'assistant',
            content: system.includes('Arabic')
              ? 'هذه هي الإجابة مكتوبة باللغة العربية الفصحى كما طلبت تماما: ' + last.content
              : 'In English: ' + last.content,
          },
        });
      }
      if (last.role === 'user') {
        log.push({ q: last.content, tools, system });
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
