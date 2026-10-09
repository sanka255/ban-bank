const http = require('http');
function req(path, token, method='GET', body){
  return new Promise((resolve,reject)=>{
    const url = new URL(path, 'http://localhost:4003');
    const headers = {'Content-Type':'application/json'};
    if(token) headers.Authorization = 'Bearer ' + token;
    const r = http.request(url, { method, headers }, (res)=>{
      let data=''; res.on('data', d=> data += d); res.on('end', ()=> resolve({status: res.statusCode, body: data}));
    });
    r.on('error', reject);
    if(body) r.write(JSON.stringify(body));
    r.end();
  });
}

(async ()=>{
  try{
    console.log('Login admin');
    const login = await req('/api/auth/login', null, 'POST', { username: 'admin', password: 'admi123' });
    if (login.status !== 200) throw new Error('Login failed: ' + login.body);
    const token = JSON.parse(login.body).token;

    // choose a free date
    console.log('Checking availability for Dec 2026');
    const availRes = await req('/api/banquet/reports/availability?fromDate=2026-12-01&toDate=2026-12-31', token);
    const avail = JSON.parse(availRes.body);
    const rows = avail.rows || [];
    let chosen = null;
    for (const r of rows){ if (r.booked === false) { chosen = r.date; break; } }
    if(!chosen) throw new Error('No free date found');
    console.log('Chosen free date', chosen);

    // create a simple reservation (no menu/items required)
    const reservationBody = { reservationCode: 'CNCL' + Date.now(), guest: { title: 'Mr', firstName: 'Cancel', lastName: 'Tester' }, numberOfGuests: 2, dateSlots: [ { partitionId: 1, fromDate: chosen, toDate: chosen, fromTime: '09:00', toTime: '12:00', charge: 150 } ] };
    const rres = await req('/api/banquet/reservations', token, 'POST', reservationBody);
    if (rres.status !== 201) throw new Error('Reservation failed: ' + rres.body);
    const reservation = JSON.parse(rres.body);
    console.log('Reservation created', reservation.id);
    const ds = reservation.dateSlots[0];

    // generate bill
    const gen = await req(`/api/banquet/date-slots/${ds.id}/generate-bill`, token, 'POST');
    if(gen.status !== 201) throw new Error('Generate bill failed: ' + gen.body);
    console.log('Generate bill succeeded:', gen.body);

    // Fetch folio before cancel
    const folioBefore = await req(`/api/banquet/reservations/${reservation.id}/folio`, token);
    console.log('Folio before cancel:', folioBefore.body);

    // cancel reservation (should cancel all slots and create withdrawals and GL postings)
    const cancel = await req(`/api/banquet/reservations/${reservation.id}/cancel`, token, 'POST', { reason: 'E2E test cancel' });
    if(cancel.status !== 200) throw new Error('Cancel reservation failed: ' + cancel.body);
    console.log('Cancel result:', cancel.body);

    // Fetch folio after cancel
    const folioAfter = await req(`/api/banquet/reservations/${reservation.id}/folio`, token);
    console.log('Folio after cancel:', folioAfter.body);

    // Check GL entries for the date
    const recon = await req(`/api/banquet/gl/reconciliation?from=${chosen}&to=${chosen}`, token);
    console.log('Reconciliation:', recon.body);

    const entries = await req(`/api/banquet/gl/entries?from=${chosen}&to=${chosen}`, token);
    console.log('GL entries for period (truncated):', entries.body.substring(0,2000));

    console.log('Cancellation/refund E2E completed successfully');
  } catch (e) { console.error('E2E cancel error', e); process.exit(1); }
})();
