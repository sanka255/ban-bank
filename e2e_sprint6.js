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
    const login = await req('/api/auth/login', null, 'POST', { username: 'admin', password: '123' });
    if (login.status !== 200) throw new Error('Login failed: ' + login.body);
    const token = JSON.parse(login.body).token;

    console.log('Checking availability for Dec 2026');
    const availRes = await req('/api/banquet/reports/availability?fromDate=2026-12-01&toDate=2026-12-31', token);
    const avail = JSON.parse(availRes.body);
    const rows = avail.rows || [];
    let chosen = null;
    for (const r of rows){ if (r.booked === false) { chosen = r.date; break; } }
    if(!chosen) throw new Error('No free date found');
    console.log('Chosen free date', chosen);

    const catRes = await req('/api/banquet/menu-categories', token, 'POST', { name: 'E2E Cat ' + Date.now() });
    if (catRes.status !== 201) throw new Error('Create category failed: ' + catRes.body);
    const cat = JSON.parse(catRes.body);

    const menuRes = await req('/api/banquet/menus', token, 'POST', { name: 'E2E Menu ' + Date.now(), isActive: true });
    if (menuRes.status !== 201) throw new Error('Create menu failed: ' + menuRes.body);
    const menu = JSON.parse(menuRes.body);

    const planRes = await req('/api/banquet/menu-rate-plans', token, 'POST', { fromDate: chosen, toDate: chosen, isActive: true, name: 'E2E Plan ' + Date.now() });
    if (planRes.status !== 201) throw new Error('Create plan failed: ' + planRes.body);
    const plan = JSON.parse(planRes.body);

    const rateRes = await req(`/api/banquet/menu-rate-plans/${plan.id}/rates`, token, 'POST', { menuId: menu.id, charge: 20 });
    if (rateRes.status !== 201) throw new Error('Create rate failed: ' + rateRes.body);

    const cat2Res = await req('/api/banquet/menu-categories', token, 'POST', { name: 'E2E Item Cat ' + Date.now() });
    if (cat2Res.status !== 201) throw new Error('Create item category failed: ' + cat2Res.body);
    const cat2 = JSON.parse(cat2Res.body);

    const itemRes = await req('/api/banquet/menu-items', token, 'POST', { name: 'E2E Item ' + Date.now(), categoryId: cat2.id, charge: 10, isActive: true });
    if (itemRes.status !== 201) throw new Error('Create item failed: ' + itemRes.body);
    const item = JSON.parse(itemRes.body);

    const reservationBody = { reservationCode: 'E2E' + Date.now(), guest: { title: 'Ms', firstName: 'E2E', lastName: 'Tester' }, numberOfGuests: 4, dateSlots: [ { partitionId: 1, fromDate: chosen, toDate: chosen, fromTime: '09:00', toTime: '12:00', charge: 200 } ] };
    const rres = await req('/api/banquet/reservations', token, 'POST', reservationBody);
    if (rres.status !== 201) throw new Error('Reservation failed: ' + rres.body);
    const reservation = JSON.parse(rres.body);
    const ds = reservation.dateSlots[0];

    const riRes = await req(`/api/banquet/date-slots/${ds.id}/requested-items`, token, 'POST', { itemId: item.id, quantity: 2 });
    if (riRes.status !== 201) throw new Error('Attach requested item failed: ' + riRes.body);

    const rmRes = await req(`/api/banquet/date-slots/${ds.id}/requested-menus`, token, 'POST', { menuId: menu.id, guestCount: 3 });
    if (rmRes.status !== 201) throw new Error('Requested menu failed: ' + rmRes.body);

    const gen = await req(`/api/banquet/date-slots/${ds.id}/generate-bill`, token, 'POST');
    if(gen.status !== 201) throw new Error('Generate bill failed: ' + gen.body);
    console.log('Generate bill succeeded:', gen.body);

    const dep = await req('/api/banquet/deposits', token, 'POST', { reservationId: reservation.id, amount: 50, paymentMethod: 'card', receiptNo: 'E2EDEP1' });
    if (dep.status !== 201) throw new Error('Create deposit failed: ' + dep.body);
    const deposit = JSON.parse(dep.body);

    const settle = await req(`/api/banquet/deposits/${deposit.id}/settle`, token, 'PUT');
    if (settle.status !== 200) throw new Error('Settle failed: ' + settle.body);

    console.log('All E2E steps executed, now running reconciliation');
    const recon = await req(`/api/banquet/gl/reconciliation?from=${chosen}&to=${chosen}`, token);
    console.log('Reconciliation:', recon.body);

    // negative test
    const imbalanceScript = `const prisma=require('./src/prisma');(async()=>{ const acc = await prisma.chartOfAccount.findFirst(); if(!acc) { console.error('no acct'); process.exit(2);} await prisma.gLEntry.create({data:{accountId:acc.id, entryType:'debit', amount:5.0, sourceType:'test_imbalance', sourceId:99999, description:'imbalance', postedBy:1}}); console.log('imbalance'); process.exit(0); })();`;
    require('fs').writeFileSync('./ins_tmp.js', imbalanceScript);
    require('child_process').execSync('node ins_tmp.js',{cwd:'.'});
    require('fs').unlinkSync('./ins_tmp.js');

    const recon2 = await req(`/api/banquet/gl/reconciliation?from=${chosen}&to=${chosen}`, token);
    console.log('Reconciliation after imbalance:', recon2.body);

    // cleanup
    const cleanupScript = `const prisma=require('./src/prisma');(async()=>{ await prisma.gLEntry.deleteMany({ where: { sourceType: 'test_imbalance', sourceId: 99999 } }); console.log('cleanup done'); process.exit(0); })();`;
    require('fs').writeFileSync('./clean_tmp.js', cleanupScript);
    require('child_process').execSync('node clean_tmp.js',{cwd:'.'});
    require('fs').unlinkSync('./clean_tmp.js');

    console.log('E2E completed');
  }catch(e){ console.error('E2E error', e); process.exit(1);} 
})();
