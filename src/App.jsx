import React, { useEffect, useRef, useState } from 'react';
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
export default function App() {
  const [menu, setMenu] = useState([]), [orders, setOrders] = useState([]), [workflow, setWorkflow] = useState({});
  const [view, setView] = useState('menu'), [category, setCategory] = useState('All');
  const [cart, setCart] = useState({}), [customer, setCustomer] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [receipt, setReceipt] = useState(null);
  const [loaded, setLoaded] = useState(false), [updated, setUpdated] = useState(null);
  const key = useRef(crypto.randomUUID());
  async function refresh(signal) {
    const [meals, queue, states] = await Promise.all([api('/menu', { signal }), api('/orders', { signal }), api('/workflow', { signal })]);
    if (signal?.aborted) return;
    setMenu(meals); setOrders(queue); setWorkflow(states); setLoaded(true); setUpdated(new Date());
  }
  useEffect(() => {
    const controller = new AbortController(); let timer;
    async function poll() {
      try { await refresh(controller.signal); } catch (e) { if (!controller.signal.aborted) setError(e.message); }
      if (!controller.signal.aborted) timer = setTimeout(poll, 10000);
    }
    poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  function change(id, delta) {
    key.current = crypto.randomUUID();
    setCart(current => ({ ...current, [id]: Math.max(0, Math.min(20, menu.find(m => m.id === id).stock, (current[id] || 0) + delta)) }));
  }
  const lines = menu.filter(m => cart[m.id] > 0), quantity = lines.reduce((sum, m) => sum + cart[m.id], 0);
  const total = lines.reduce((sum, m) => sum + m.price_cents * cart[m.id], 0);
  const currentReceipt = receipt && (orders.find(o => o.id === receipt.id) ?? receipt);
  async function checkout(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api('/orders', { method: 'POST', headers: { 'Idempotency-Key': key.current }, body: JSON.stringify({ customer, items: lines.map(m => ({ meal_id: m.id, quantity: cart[m.id] })) }) });
      setReceipt(result.order); setCart({}); key.current = crypto.randomUUID(); await refresh();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function move(order, status) {
    setBusy(true); setError('');
    try { await api(`/orders/${order.id}`, { method: 'PATCH', body: JSON.stringify({ status, version: order.version }) }); await refresh(); }
    catch (e) { setError(e.message); await refresh().catch(() => {}); } finally { setBusy(false); }
  }
  return <div className="shell"><header><a href="/" className="brand"><span className="mark">D.</span>DISPATCH<span className="subbrand">KITCHEN</span></a><nav aria-label="Workspace"><button aria-pressed={view === 'menu'} onClick={() => setView('menu')}>Order menu</button><button aria-pressed={view === 'kitchen'} onClick={() => setView('kitchen')}>Kitchen queue <span>{orders.filter(o => !['completed', 'cancelled'].includes(o.status)).length}</span></button></nav><span className="demo">LOCAL DEMO</span></header>
    <main><div className="intro"><div><p className="eyebrow">GOOD FOOD. SMOOTH SERVICE.</p><h1>{view === 'menu' ? 'Made fresh. On your terms.' : 'Every order, moving forward.'}</h1><p>{view === 'menu' ? 'Comfort classics and fresh favorites. Build your pickup order.' : 'Track the handoff from incoming ticket to completed pickup.'}</p></div><div className="status"><i/> {loaded ? 'Kitchen connected' : 'Connecting…'}<small>{updated ? `Updated ${updated.toLocaleTimeString()}` : 'Fetching the menu'}</small></div></div>
    {error && <div className="alert" role="alert">{error}<button onClick={() => refresh().then(() => setError('')).catch(e => setError(e.message))}>Refresh</button></div>}
    {view === 'menu' ? <div className="layout"><section><div className="categories">{['All', ...new Set(menu.map(m => m.category))].map(c => <button key={c} aria-pressed={c === category} onClick={() => setCategory(c)}>{c === 'All' ? 'All dishes' : c}</button>)}</div><div className="menu">{menu.filter(m => category === 'All' || m.category === category).map(meal => <article className="meal" key={meal.id}><div className="photo"><img src={`/images/${meal.image}`} alt={meal.name}/><span>{meal.category}</span></div><div className="mealbody"><h2>{meal.name}</h2><p>{meal.description}</p><div className="mealfooter"><strong>{money(meal.price_cents)}</strong><button aria-label={`Add ${meal.name}`} disabled={busy || !meal.stock || cart[meal.id] >= Math.min(meal.stock, 20)} onClick={() => change(meal.id, 1)}>+</button></div><small>{meal.stock ? `${meal.stock} portions available` : 'Sold out for this session'}</small></div></article>)}</div>{!loaded && <p role="status">Loading menu…</p>}</section>
    <aside><section className="basket"><div className="baskethead"><h2>Your order</h2><span>{quantity} items</span></div>{!lines.length ? <div className="empty"><span>✦</span><h3>Something good starts here.</h3><p>Add a dish from the menu to build your pickup order.</p></div> : <><ul className="cart">{lines.map(meal => <li key={meal.id}><div><strong>{meal.name}</strong><p>{money(meal.price_cents * cart[meal.id])}</p></div><div className="quantity"><button aria-label={`Remove one ${meal.name}`} disabled={busy} onClick={() => change(meal.id, -1)}>−</button><span>{cart[meal.id]}</span><button aria-label={`Add one ${meal.name}`} disabled={busy || cart[meal.id] >= Math.min(meal.stock, 20)} onClick={() => change(meal.id, 1)}>+</button></div></li>)}</ul><div className="total"><span>Total</span><strong>{money(total)}</strong></div><form onSubmit={checkout}><label>Pickup name<input required maxLength={80} value={customer} disabled={busy} onChange={e => { setCustomer(e.target.value); key.current = crypto.randomUUID(); }} placeholder="Demo guest"/></label><button className="primary" disabled={busy || !quantity}>{busy ? 'Submitting…' : 'Place demo order →'}</button></form></>}<p className="disclaimer">Simulated pickup only. No payment, tax, delivery, or real restaurant service.</p></section>
    {currentReceipt && <section className="receipt" role="status"><p className="eyebrow">ORDER RECEIVED</p><h2>Thanks, {currentReceipt.customer}.</h2><p>Ticket #{currentReceipt.id.slice(0, 8)} · {money(currentReceipt.total_cents)}</p><strong className="badge">{currentReceipt.status}</strong><p className="small">Your status refreshes every 10 seconds. Use the kitchen queue to advance the demo.</p></section>}</aside></div> : <><div className="metrics">{[['Active tickets', orders.filter(o => !['completed', 'cancelled'].includes(o.status)).length], ['Ready for pickup', orders.filter(o => o.status === 'ready').length], ['Completed orders', orders.filter(o => o.status === 'completed').length], ['Completed value', money(orders.filter(o => o.status === 'completed').reduce((s, o) => s + o.total_cents, 0))]].map(([name, value]) => <div key={name}><span>{name}</span><strong>{value}</strong></div>)}</div><div className="board">{['received', 'preparing', 'ready'].map(stage => <section className="lane" key={stage}><h2><i className={stage}/>{stage} <span>{orders.filter(o => o.status === stage).length}</span></h2>{orders.filter(o => o.status === stage).map(order => <article className="ticket" key={order.id}><div className="tickethead"><strong>#{order.id.slice(0, 8)}</strong><time>{new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><h3>{order.customer}</h3><ul>{order.items.map(item => <li key={item.meal_id}><b>{item.quantity}×</b> {item.name}</li>)}</ul><div className="ticketfooter"><strong>{money(order.total_cents)}</strong><span>v{order.version}</span></div><div className="actions">{(workflow[stage] || []).map(next => <button className={next === 'cancelled' ? 'cancel' : 'primary'} key={next} disabled={busy} onClick={() => move(order, next)}>{next === 'cancelled' ? 'Cancel' : `Mark ${next}`}</button>)}</div></article>)}{!orders.some(o => o.status === stage) && <p className="emptylane">No tickets here.</p>}</section>)}</div><details className="history"><summary>Completed & cancelled orders ({orders.filter(o => ['completed', 'cancelled'].includes(o.status)).length})</summary>{orders.filter(o => ['completed', 'cancelled'].includes(o.status)).map(o => <p key={o.id}>#{o.id.slice(0, 8)} · {o.customer} · {o.status} · {money(o.total_cents)}</p>)}</details></>}
    </main><footer><span>Dispatch Kitchen · Inventory-aware ordering</span><span>Demo catalog · Prices in USD · Single local operator</span></footer></div>;
}
