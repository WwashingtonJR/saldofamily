let transactions = [];
let goals = [];
let currentType = 'deposito';
const STORAGE_PREFIX = 'mes:';
const LEGACY_KEY = 'saldo_transactions';
const GOALS_KEY = 'sonhos';

function genId(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2,6);
}

// Adaptador: usa o armazenamento do Claude quando disponível (dentro da conversa),
// e cai automaticamente para o localStorage do navegador quando o app é aberto
// sozinho (arquivo baixado, fora do Claude). Assim os dados nunca somem.
const usandoClaudeStorage = (typeof window.storage !== 'undefined');

const storageAdapter = {
  async get(key, shared){
    if(usandoClaudeStorage) return window.storage.get(key, shared);
    const raw = localStorage.getItem(key);
    return raw === null ? null : { key, value: raw, shared: !!shared };
  },
  async set(key, value, shared){
    if(usandoClaudeStorage) return window.storage.set(key, value, shared);
    localStorage.setItem(key, value);
    return { key, value, shared: !!shared };
  },
  async delete(key, shared){
    if(usandoClaudeStorage) return window.storage.delete(key, shared);
    localStorage.removeItem(key);
    return { key, deleted: true, shared: !!shared };
  },
  async list(prefix, shared){
    if(usandoClaudeStorage) return window.storage.list(prefix, shared);
    const keys = [];
    for(let i=0; i<localStorage.length; i++){
      const k = localStorage.key(i);
      if(!prefix || k.startsWith(prefix)) keys.push(k);
    }
    return { keys, prefix, shared: !!shared };
  }
};

function parseMoneyInput(str){
  return parseFloat((str || '').trim().replace(/\./g, '').replace(',', '.'));
}

function applyMoneyMask(el){
  let digits = el.value.replace(/\D/g, '');
  digits = digits.replace(/^0+(?=\d)/, '');
  if(digits === ''){ el.value = ''; return; }
  const cents = parseInt(digits, 10);
  const reais = cents / 100;
  el.value = reais.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
}

function monthKeyOf(dataStr){
  const [y, m] = dataStr.split('-');
  return `${y}-${m}`;
}

async function getMonthArray(monthKey){
  try{
    const res = await storageAdapter.get(STORAGE_PREFIX + monthKey, false);
    return res ? JSON.parse(res.value) : [];
  }catch(err){
    return [];
  }
}

async function saveMonthArray(monthKey, arr){
  try{
    await storageAdapter.set(STORAGE_PREFIX + monthKey, JSON.stringify(arr), false);
  }catch(err){
    console.error('Falha ao salvar o mês', monthKey, err);
  }
}

async function loadTransactions(){
  transactions = [];
  try{
    const listResult = await storageAdapter.list(STORAGE_PREFIX, false);
    const keys = listResult ? listResult.keys : [];

    if(keys.length === 0){
      // migração única: se existir o formato antigo (tudo num só lugar), separa por mês
      try{
        const legacy = await storageAdapter.get(LEGACY_KEY, false);
        if(legacy){
          const oldArr = JSON.parse(legacy.value);
          const byMonth = {};
          oldArr.forEach(t => {
            const mk = monthKeyOf(t.data);
            if(!byMonth[mk]) byMonth[mk] = [];
            byMonth[mk].push(t);
          });
          for(const mk of Object.keys(byMonth)){
            await saveMonthArray(mk, byMonth[mk]);
          }
          transactions = oldArr;
          render();
          return;
        }
      }catch(e){ /* sem dados antigos, segue normal */ }
    }

    for(const key of keys){
      try{
        const res = await storageAdapter.get(key, false);
        if(res){
          const arr = JSON.parse(res.value);
          transactions.push(...arr);
        }
      }catch(e){ /* ignora mês corrompido, mantém o resto */ }
    }
  }catch(err){
    transactions = [];
  }
  render();
}

async function loadGoals(){
  try{
    const res = await storageAdapter.get(GOALS_KEY, false);
    goals = res ? JSON.parse(res.value) : [];
  }catch(err){
    goals = [];
  }
  renderGoals();
}

async function saveGoals(){
  try{
    await storageAdapter.set(GOALS_KEY, JSON.stringify(goals), false);
  }catch(err){
    console.error('Falha ao salvar sonhos', err);
  }
}

const fmt = (n) => (n < 0 ? '-' : '') + 'R$ ' + Math.abs(n).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});

document.getElementById('fData').valueAsDate = new Date();

const fValorInput = document.getElementById('fValor');
fValorInput.addEventListener('input', () => applyMoneyMask(fValorInput));

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('viewSaldo').style.display = tab === 'saldo' ? 'block' : 'none';
    document.getElementById('viewSonhos').style.display = tab === 'sonhos' ? 'block' : 'none';
    document.getElementById('viewParty').style.display = tab === 'party' ? 'block' : 'none';
  });
});

const fieldCategoria = document.getElementById('fieldCategoria');

document.getElementById('typeToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if(!btn) return;
  currentType = btn.dataset.type;
  document.querySelectorAll('#typeToggle button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  fieldCategoria.classList.toggle('hidden', currentType === 'deposito');
});

document.getElementById('txForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const desc = document.getElementById('fDesc').value.trim();
  const valor = parseMoneyInput(document.getElementById('fValor').value);
  const categoria = currentType === 'gasto' ? document.getElementById('fCategoria').value : '';
  const data = document.getElementById('fData').value;
  if(!desc || !data || isNaN(valor) || valor <= 0){
    alert('Confere aí: preencha descrição, valor e data corretamente.');
    return;
  }

  const novaTx = {
    id: genId(),
    type: currentType,
    desc, categoria, valor, data
  };
  const monthKey = monthKeyOf(data);

  transactions.push(novaTx);
  const monthArr = await getMonthArray(monthKey);
  monthArr.push(novaTx);
  await saveMonthArray(monthKey, monthArr);

  document.getElementById('fDesc').value = '';
  document.getElementById('fValor').value = '';
  render();
});

async function deleteTx(id){
  const tx = transactions.find(t => t.id === id);
  if(!tx) return;
  transactions = transactions.filter(t => t.id !== id);

  const monthKey = monthKeyOf(tx.data);
  const monthArr = await getMonthArray(monthKey);
  await saveMonthArray(monthKey, monthArr.filter(t => t.id !== id));

  render();
}

document.getElementById('sonhoMeta').addEventListener('input', (e) => applyMoneyMask(e.target));

document.getElementById('formSonho').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome = document.getElementById('sonhoNome').value.trim();
  const meta = parseMoneyInput(document.getElementById('sonhoMeta').value);
  if(!nome || isNaN(meta) || meta <= 0){
    alert('Confere aí: preencha o nome do sonho e uma meta válida.');
    return;
  }
  goals.push({ id: genId(), nome, meta, guardado: 0 });
  await saveGoals();
  document.getElementById('sonhoNome').value = '';
  document.getElementById('sonhoMeta').value = '';
  renderGoals();
});

const sonhosListEl = document.getElementById('sonhosList');

sonhosListEl.addEventListener('input', (e) => {
  if(e.target.classList.contains('mask-money')) applyMoneyMask(e.target);
});

sonhosListEl.addEventListener('click', async (e) => {
  const addBtn = e.target.closest('.goal-add-btn');
  if(addBtn){
    const goalId = addBtn.dataset.goalId;
    const input = sonhosListEl.querySelector(`.goal-input[data-goal-id="${goalId}"]`);
    const valor = parseMoneyInput(input.value);
    if(isNaN(valor) || valor <= 0){
      alert('Digite um valor válido pra guardar nesse sonho.');
      return;
    }
    const goal = goals.find(g => g.id === goalId);
    if(!goal) return;

    const hoje = new Date().toISOString().slice(0,10);
    const novaTx = {
      id: genId(),
      type: 'investimento',
      desc: `Guardado p/ sonho: ${goal.nome}`,
      categoria: goal.nome,
      valor,
      data: hoje
    };
    const monthKey = monthKeyOf(hoje);
    transactions.push(novaTx);
    const monthArr = await getMonthArray(monthKey);
    monthArr.push(novaTx);
    await saveMonthArray(monthKey, monthArr);

    goal.guardado += valor;
    await saveGoals();

    render();
    renderGoals();
    return;
  }

  const delBtn = e.target.closest('[data-del-goal]');
  if(delBtn){
    const goalId = delBtn.dataset.delGoal;
    if(!confirm('Remover esse sonho? O dinheiro já guardado nele continua contabilizado no seu saldo como guardado.')) return;
    goals = goals.filter(g => g.id !== goalId);
    await saveGoals();
    renderGoals();
  }
});

function renderGoals(){
  const totalGuardado = goals.reduce((s,g) => s + g.guardado, 0);
  const totalEl = document.getElementById('sonhosTotalValue');
  if(totalEl) totalEl.textContent = fmt(totalGuardado);

  if(goals.length === 0){
    sonhosListEl.innerHTML = '<div class="panel"><div class="empty">Nenhum sonho cadastrado ainda.<br>Cria ali em cima e começa a guardar.</div></div>';
    if(typeof renderRanking === 'function') renderRanking();
    return;
  }

  sonhosListEl.innerHTML = goals.map(g => {
    const pct = Math.min(100, (g.guardado / g.meta) * 100);
    const done = g.guardado >= g.meta;
    return `
      <div class="panel goal-card">
        <div class="goal-head">
          <div class="goal-name">${escapeHtml(g.nome)} ${done ? '<span class="goal-done">✓ realizado</span>' : ''}</div>
          <button class="row-del" data-del-goal="${g.id}" title="Remover sonho">×</button>
        </div>
        <div class="goal-values">
          <span class="goal-guardado">${fmt(g.guardado)}</span> de <span class="goal-meta">${fmt(g.meta)}</span>
        </div>
        <div class="bar-track goal-track"><div class="bar-fill goal-fill" style="width:${pct.toFixed(1)}%"></div></div>
        <div class="goal-pct">${pct.toFixed(0)}% guardado</div>
        ${!done ? `
        <div class="goal-contribute">
          <input type="text" inputmode="numeric" class="mask-money goal-input" data-goal-id="${g.id}" placeholder="0,00">
          <button type="button" class="goal-add-btn" data-goal-id="${g.id}">Guardar</button>
        </div>` : ''}
      </div>
    `;
  }).join('');

  if(typeof renderRanking === 'function') renderRanking();
}

function render(){
  const depositado = transactions.filter(t=>t.type==='deposito').reduce((s,t)=>s+t.valor,0);
  const gasto = transactions.filter(t=>t.type==='gasto').reduce((s,t)=>s+t.valor,0);
  const investido = transactions.filter(t=>t.type==='investimento').reduce((s,t)=>s+t.valor,0);
  const saldo = depositado - gasto - investido;

  document.getElementById('statDepositado').textContent = fmt(depositado);
  document.getElementById('statGasto').textContent = fmt(gasto);
  document.getElementById('statInvestido').textContent = fmt(investido);
  document.getElementById('statCount').textContent = transactions.length;

  const balEl = document.getElementById('balanceValue');
  const stampEl = document.getElementById('stamp');
  balEl.textContent = fmt(saldo);
  balEl.className = 'balance-value ' + (saldo >= 0 ? 'pos' : 'neg');
  stampEl.className = 'stamp ' + (saldo >= 0 ? 'pos' : 'neg');
  stampEl.textContent = saldo >= 0 ? 'NO AZUL' : 'NO VERMELHO';

  // category bars (gastos only, all time)
  const catMap = {};
  transactions.filter(t=>t.type==='gasto').forEach(t=>{
    const cat = t.categoria || 'Outros';
    catMap[cat] = (catMap[cat]||0) + t.valor;
  });
  const cats = Object.entries(catMap).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const barsPanel = document.getElementById('barsPanel');
  const barsContainer = document.getElementById('barsContainer');
  if(cats.length === 0){
    barsPanel.style.display = 'none';
  } else {
    barsPanel.style.display = 'block';
    const max = cats[0][1];
    barsContainer.innerHTML = cats.map(([cat, val]) => `
      <div class="bar-row">
        <div class="bar-label">${cat}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${(val/max*100).toFixed(1)}%"></div></div>
        <div class="bar-amount">${fmt(val)}</div>
      </div>
    `).join('');
  }

  // months
  const monthsEl = document.getElementById('months');
  if(transactions.length === 0){
    monthsEl.innerHTML = '<div class="panel"><div class="empty">Nada registrado ainda.<br>Faça seu primeiro depósito ou gasto acima.</div></div>';
    return;
  }

  const sorted = [...transactions].sort((a,b) => b.data.localeCompare(a.data));
  const groups = {};
  sorted.forEach(t => {
    const [y,m] = t.data.split('-');
    const key = `${y}-${m}`;
    if(!groups[key]) groups[key] = [];
    groups[key].push(t);
  });

  const monthNames = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

  monthsEl.innerHTML = Object.entries(groups).map(([key, items]) => {
    const [y,m] = key.split('-');
    const label = `${monthNames[parseInt(m)-1]} de ${y}`;
    const monthDep = items.filter(t=>t.type==='deposito').reduce((s,t)=>s+t.valor,0);
    const monthGasto = items.filter(t=>t.type==='gasto').reduce((s,t)=>s+t.valor,0);
    const monthInvestido = items.filter(t=>t.type==='investimento').reduce((s,t)=>s+t.valor,0);
    const monthSaldo = monthDep - monthGasto - monthInvestido;

    const rows = items.map(t => {
      const [,, d] = t.data.split('-');
      const sign = t.type === 'gasto' ? '−' : (t.type === 'investimento' ? '↗' : '+');
      const catTag = t.categoria ? `<div class="row-cat">${escapeHtml(t.categoria)}</div>` : '';
      return `
        <div class="row">
          <div class="row-date">${d}</div>
          <div class="row-mid">
            <div class="row-desc">${escapeHtml(t.desc)}</div>
            ${catTag}
          </div>
          <div class="row-leader"></div>
          <div class="row-amount ${t.type}">${sign} ${fmt(t.valor)}</div>
          <button class="row-del" data-id="${t.id}" title="Remover">×</button>
        </div>
      `;
    }).join('');

    return `
      <div class="month-block">
        <div class="month-header">
          <div class="month-name">${label}</div>
          <div class="month-summary">
            <span class="gold">+ ${fmt(monthDep)}</span>
            <span class="red">− ${fmt(monthGasto)}</span>
            ${monthInvestido > 0 ? `<span style="color:var(--gold-dim)">↗ ${fmt(monthInvestido)}</span>` : ''}
            <span class="${monthSaldo>=0?'saldo-pos':'saldo-neg'}">= ${fmt(monthSaldo)}</span>
          </div>
        </div>
        ${rows}
      </div>
    `;
  }).join('');

  document.querySelectorAll('.row-del').forEach(btn => {
    btn.addEventListener('click', () => deleteTx(btn.dataset.id));
  });
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- PARTY ----------
let meuPerfil = { apelido: '', meuId: '' };
let rankingAmigos = [];

function b64Encode(str){ return btoa(unescape(encodeURIComponent(str))); }
function b64Decode(str){ return decodeURIComponent(escape(atob(str))); }

async function loadParty(){
  try{
    const res = await storageAdapter.get('party_perfil', false);
    meuPerfil = res ? JSON.parse(res.value) : { apelido: '', meuId: genId() };
  }catch(e){
    meuPerfil = { apelido: '', meuId: genId() };
  }
  if(!meuPerfil.meuId) meuPerfil.meuId = genId();
  document.getElementById('meuApelido').value = meuPerfil.apelido || '';

  try{
    const res2 = await storageAdapter.get('party_ranking', false);
    rankingAmigos = res2 ? JSON.parse(res2.value) : [];
  }catch(e){
    rankingAmigos = [];
  }
  renderRanking();
}

async function savePerfil(){
  await storageAdapter.set('party_perfil', JSON.stringify(meuPerfil), false);
}
async function saveRankingAmigos(){
  await storageAdapter.set('party_ranking', JSON.stringify(rankingAmigos), false);
}

document.getElementById('formApelido').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome = document.getElementById('meuApelido').value.trim();
  if(!nome) return;
  meuPerfil.apelido = nome;
  await savePerfil();
  renderRanking();
});

document.getElementById('btnGerarCodigo').addEventListener('click', async () => {
  if(!meuPerfil.apelido){
    alert('Salva seu apelido ali em cima primeiro.');
    return;
  }
  const valor = goals.reduce((s,g) => s + g.guardado, 0);
  const payload = { v:1, id: meuPerfil.meuId, apelido: meuPerfil.apelido, valor, data: new Date().toISOString().slice(0,10) };
  const code = 'SALDO1:' + b64Encode(JSON.stringify(payload));

  const box = document.getElementById('codigoBox');
  const output = document.getElementById('codigoOutput');
  output.value = code;
  box.style.display = 'block';

  if(navigator.clipboard){
    try{ await navigator.clipboard.writeText(code); }catch(e){ /* sem clipboard, sem problema, o código já tá na caixa pra copiar manual */ }
  }
});

document.getElementById('formColarCodigo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('codigoInput');
  const raw = input.value.trim();

  if(!raw.startsWith('SALDO1:')){
    alert('Esse código não parece válido. Confere se colou certinho.');
    return;
  }
  try{
    const payload = JSON.parse(b64Decode(raw.slice('SALDO1:'.length)));
    if(payload.id === meuPerfil.meuId){
      alert('Esse código é o seu próprio placar :)');
      return;
    }
    const existente = rankingAmigos.find(r => r.id === payload.id);
    if(existente){
      existente.apelido = payload.apelido;
      existente.valor = payload.valor;
      existente.atualizadoEm = payload.data;
    } else {
      rankingAmigos.push({ id: payload.id, apelido: payload.apelido, valor: payload.valor, atualizadoEm: payload.data });
    }
    await saveRankingAmigos();
    input.value = '';
    renderRanking();
  }catch(err){
    alert('Não consegui ler esse código. Confere se copiou ele inteiro.');
  }
});

function renderRanking(){
  const meuValor = goals.reduce((s,g) => s + g.guardado, 0);
  const placarEl = document.getElementById('meuPlacarValor');
  if(placarEl) placarEl.textContent = fmt(meuValor);

  const todos = [
    { id: meuPerfil.meuId, apelido: meuPerfil.apelido || 'Você', valor: meuValor, isMe: true },
    ...rankingAmigos.map(r => ({ ...r, isMe: false }))
  ];
  todos.sort((a,b) => b.valor - a.valor);

  const el = document.getElementById('rankingList');
  if(!el) return;

  if(todos.length === 1 && !meuPerfil.apelido){
    el.innerHTML = '<div class="empty">Salva seu apelido e cola o código de um amigo pra começar o ranking.</div>';
    return;
  }

  el.innerHTML = todos.map((r, i) => `
    <div class="rank-row ${i===0 ? 'top1' : ''}">
      <div class="rank-pos">${i+1}º</div>
      <div class="rank-name ${r.isMe ? 'me' : ''}">${escapeHtml(r.apelido)}</div>
      <div class="rank-value">${fmt(r.valor)}</div>
    </div>
  `).join('');
}

loadTransactions();
loadGoals();
loadParty();

document.getElementById('btnExport').addEventListener('click', async () => {
  const box = document.getElementById('exportBox');
  if(box.style.display === 'block'){
    box.style.display = 'none';
    return;
  }
  const ordered = [...transactions].sort((a,b) => a.data.localeCompare(b.data));
  const json = JSON.stringify(ordered, null, 2);
  box.textContent = json;
  box.style.display = 'block';

  if(navigator.clipboard){
    try{ await navigator.clipboard.writeText(json); }catch(e){ /* clipboard pode estar bloqueado no navegador, sem problema */ }
  }
});
