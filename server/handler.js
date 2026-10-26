/**
 * 애드클로버 마케팅 진단서 - 실측 데이터 프록시
 *
 * 브라우저에 API 키를 노출하지 않고, CORS 제약이 있는 공공/상용 API를 대신 호출합니다.
 * Web 표준 Request/Response만 사용하므로 Cloudflare Workers(worker.js)와
 * Node 18+(dev-server.js) 양쪽에서 동일하게 동작합니다.
 *
 * 필요한 환경 변수(없는 항목은 해당 엔드포인트만 501 NOT_CONFIGURED 응답):
 *   KAKAO_REST_KEY                 카카오 REST API 키          (/api/geocode, /api/places)
 *   NAVER_CLIENT_ID / _SECRET      네이버 개발자센터 검색 API   (/api/blog)
 *   NAVER_SEARCHAD_CUSTOMER_ID     네이버 검색광고 API          (/api/keywords)
 *   NAVER_SEARCHAD_API_KEY
 *   NAVER_SEARCHAD_SECRET
 *   DATA_GO_KR_KEY                 공공데이터포털 인증키        (/api/nts, /api/population)
 * 선택:
 *   ALLOWED_ORIGINS                쉼표 구분 허용 Origin (기본 *)
 *   POPULATION_API_URL             행안부 인구 API URL 재정의
 *   KAKAO_BASE, NAVER_OPEN_BASE, SEARCHAD_BASE, ODCLOUD_BASE, DATAGO_BASE  (테스트용 업스트림 주소)
 */

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const DEFAULTS = {
  KAKAO_BASE: 'https://dapi.kakao.com',
  NAVER_OPEN_BASE: 'https://openapi.naver.com',
  SEARCHAD_BASE: 'https://api.searchad.naver.com',
  ODCLOUD_BASE: 'https://api.odcloud.kr',
  DATAGO_BASE: 'https://apis.data.go.kr'
};
const base = (env, k) => String(env[k] || DEFAULTS[k]).replace(/\/+$/, '');
const TIMEOUT_MS = 8000;

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, headers || {})
  });
}

function corsHeaders(request, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
  const origin = request.headers.get('origin');
  const common = { 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
  if (allowed.includes('*')) return Object.assign({ 'access-control-allow-origin': '*' }, common);
  if (!origin) return common;
  if (allowed.includes(origin)) return Object.assign({ 'access-control-allow-origin': origin, vary: 'Origin' }, common);
  return null;
}

async function fetchJson(url, init, label) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res;
  try { res = await fetch(url, Object.assign({}, init, { signal: ctl.signal })); }
  catch (e) { throw new ApiError(504, 'UPSTREAM_TIMEOUT', label + ' 호출 실패: ' + (e && e.name === 'AbortError' ? '시간 초과' : e.message)); }
  finally { clearTimeout(timer); }
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* non-json */ }
  if (!res.ok) {
    const detail = data ? (data.message || data.errorMessage || data.msg || data.detail || JSON.stringify(data)) : text.slice(0, 160);
    throw new ApiError(502, 'UPSTREAM_' + res.status, label + ' HTTP ' + res.status + ': ' + String(detail).slice(0, 200));
  }
  if (data === null) throw new ApiError(502, 'UPSTREAM_FORMAT', label + ' 응답이 JSON이 아닙니다: ' + text.slice(0, 120));
  return data;
}

function need(env, names, what) {
  const missing = names.filter(n => !env[n]);
  if (missing.length) throw new ApiError(501, 'NOT_CONFIGURED', what + ' 키가 서버에 설정되지 않았습니다 (' + missing.join(', ') + ')');
}

const num = v => {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v);
  if (s.indexOf('<') >= 0) return 5;
  const n = parseInt(s.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};

/* ---------- 카카오 로컬: 주소 → 좌표·행정동 ---------- */
async function geocode(q, env) {
  need(env, ['KAKAO_REST_KEY'], '카카오 REST');
  const query = (q.get('q') || '').trim();
  if (!query) throw new ApiError(400, 'BAD_REQUEST', 'q(주소)가 필요합니다');
  const headers = { Authorization: 'KakaoAK ' + env.KAKAO_REST_KEY };
  const addr = await fetchJson(base(env, 'KAKAO_BASE') + '/v2/local/search/address.json?size=1&query=' + encodeURIComponent(query), { headers }, '카카오 주소검색');
  let d = addr.documents && addr.documents[0];
  if (!d) {
    const kw = await fetchJson(base(env, 'KAKAO_BASE') + '/v2/local/search/keyword.json?size=1&query=' + encodeURIComponent(query), { headers }, '카카오 키워드검색');
    const k = kw.documents && kw.documents[0];
    if (!k) throw new ApiError(404, 'NOT_FOUND', '주소를 찾지 못했습니다: ' + query);
    return { x: +k.x, y: +k.y, name: k.address_name, r1: '', r2: '', r3: '', hdong: '', bdong: '', hcode: '', bcode: '', road: k.road_address_name || '', matched: 'keyword' };
  }
  const a = d.address || {};
  const r = d.road_address || {};
  return {
    x: +d.x, y: +d.y, name: d.address_name,
    r1: a.region_1depth_name || r.region_1depth_name || '', r2: a.region_2depth_name || r.region_2depth_name || '', r3: a.region_3depth_name || r.region_3depth_name || '',
    hdong: a.region_3depth_h_name || '', bdong: a.region_3depth_name || r.region_3depth_name || '', hcode: a.h_code || '', bcode: a.b_code || '',
    road: r.road_name || '', matched: 'address'
  };
}

/* ---------- 카카오 로컬: 반경별 동종 업소 수 + 가까운 업소 목록 ---------- */
async function places(q, env) {
  need(env, ['KAKAO_REST_KEY'], '카카오 REST');
  const query = (q.get('q') || '').trim();
  const x = parseFloat(q.get('x')), y = parseFloat(q.get('y'));
  if (!query || !Number.isFinite(x) || !Number.isFinite(y)) throw new ApiError(400, 'BAD_REQUEST', 'q, x, y가 필요합니다');
  const radii = (q.get('radii') || '500,1000,2000').split(',').map(n => parseInt(n, 10)).filter(n => n > 0 && n <= 20000).slice(0, 4);
  const headers = { Authorization: 'KakaoAK ' + env.KAKAO_REST_KEY };
  const call = r => fetchJson(base(env, 'KAKAO_BASE') + '/v2/local/search/keyword.json?sort=distance&size=15&query=' + encodeURIComponent(query) + '&x=' + x + '&y=' + y + '&radius=' + r, { headers }, '카카오 키워드검색(' + r + 'm)');
  const results = await Promise.all(radii.map(call));
  const counts = {};
  radii.forEach((r, i) => { counts[r] = (results[i].meta && results[i].meta.total_count) || 0; });
  const widest = results[Math.min(1, results.length - 1)] || results[0] || { documents: [] };
  const exclude = (q.get('exclude') || '').replace(/\s/g, '');
  const seen = new Set();
  const top = (widest.documents || []).filter(d => {
    const nm = String(d.place_name || '').replace(/\s/g, '');
    if (!nm || seen.has(nm) || (exclude && (nm.indexOf(exclude) >= 0 || exclude.indexOf(nm) >= 0))) return false;
    seen.add(nm); return true;
  }).slice(0, 8).map(d => ({ name: d.place_name, distance: num(d.distance), address: d.road_address_name || d.address_name || '', category: d.category_name || '', phone: d.phone || '', id: d.id }));
  return { query, counts, top };
}

/* ---------- 국세청 사업자 상태 ---------- */
async function nts(q, env) {
  need(env, ['DATA_GO_KR_KEY'], '공공데이터포털');
  const bno = (q.get('bno') || '').replace(/[^0-9]/g, '');
  if (bno.length !== 10) throw new ApiError(400, 'BAD_REQUEST', '사업자등록번호 10자리가 필요합니다');
  const key = /%[0-9A-Fa-f]{2}/.test(env.DATA_GO_KR_KEY) ? env.DATA_GO_KR_KEY : encodeURIComponent(env.DATA_GO_KR_KEY);
  const data = await fetchJson(base(env, 'ODCLOUD_BASE') + '/api/nts-businessman/v1/status?serviceKey=' + key, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ b_no: [bno] })
  }, '국세청 상태조회');
  const row = data.data && data.data[0];
  if (!row) throw new ApiError(502, 'UPSTREAM_FORMAT', '국세청 응답에 data가 없습니다');
  const registered = !!row.b_stt;
  return {
    bno, registered, status: row.b_stt || '', statusCode: row.b_stt_cd || '', taxType: registered ? (row.tax_type || '') : '',
    taxTypeCode: row.tax_type_cd || '', endDate: row.end_dt || '', message: registered ? '' : (row.tax_type || '국세청에 등록되지 않은 사업자등록번호입니다'), queriedAt: new Date().toISOString()
  };
}

/* ---------- 네이버 검색광고 키워드도구 (월 검색량) ---------- */
async function hmacBase64(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  let bin = ''; for (let i = 0; i < sig.length; i++) bin += String.fromCharCode(sig[i]);
  return btoa(bin);
}
export async function searchadHeaders(env, method, path, now) {
  const ts = String(now || Date.now());
  return { 'X-Timestamp': ts, 'X-API-KEY': env.NAVER_SEARCHAD_API_KEY, 'X-Customer': env.NAVER_SEARCHAD_CUSTOMER_ID, 'X-Signature': await hmacBase64(env.NAVER_SEARCHAD_SECRET, ts + '.' + method + '.' + path) };
}
async function keywords(q, env) {
  need(env, ['NAVER_SEARCHAD_CUSTOMER_ID', 'NAVER_SEARCHAD_API_KEY', 'NAVER_SEARCHAD_SECRET'], '네이버 검색광고');
  const asked = (q.get('kw') || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!asked.length) throw new ApiError(400, 'BAD_REQUEST', 'kw(쉼표 구분 키워드)가 필요합니다');
  const stripped = Array.from(new Set(asked.map(k => k.replace(/\s+/g, '')))).slice(0, 10);
  const chunks = []; for (let i = 0; i < stripped.length; i += 5) chunks.push(stripped.slice(i, i + 5));
  const path = '/keywordstool';
  const lists = await Promise.all(chunks.map(async chunk => {
    const headers = await searchadHeaders(env, 'GET', path);
    const d = await fetchJson(base(env, 'SEARCHAD_BASE') + path + '?showDetail=1&hintKeywords=' + encodeURIComponent(chunk.join(',')), { headers }, '네이버 검색광고');
    return d.keywordList || [];
  }));
  const all = [].concat.apply([], lists);
  const items = []; const notFound = [];
  stripped.forEach(k => {
    const hit = all.find(r => String(r.relKeyword).toLowerCase() === k.toLowerCase());
    if (!hit) { notFound.push(k); return; }
    const pc = num(hit.monthlyPcQcCnt), mobile = num(hit.monthlyMobileQcCnt);
    items.push({ kw: k, pc, mobile, total: pc + mobile, compIdx: hit.compIdx || '', plAvgDepth: Number(hit.plAvgDepth) || 0, avgClk: Math.round((Number(hit.monthlyAvePcClkCnt) || 0) + (Number(hit.monthlyAveMobileClkCnt) || 0)) });
  });
  return { items, notFound, period: '최근 30일' };
}

/* ---------- 네이버 검색 API: 블로그 게시량 ---------- */
async function blog(q, env) {
  need(env, ['NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET'], '네이버 검색');
  const qs = q.getAll('q').map(s => s.trim()).filter(Boolean).slice(0, 6);
  if (!qs.length) throw new ApiError(400, 'BAD_REQUEST', 'q가 필요합니다');
  const headers = { 'X-Naver-Client-Id': env.NAVER_CLIENT_ID, 'X-Naver-Client-Secret': env.NAVER_CLIENT_SECRET };
  const items = await Promise.all(qs.map(async s => {
    const d = await fetchJson(base(env, 'NAVER_OPEN_BASE') + '/v1/search/blog.json?display=1&query=' + encodeURIComponent(s), { headers }, '네이버 블로그 검색');
    return { q: s, total: num(d.total) };
  }));
  return { items };
}

/* ---------- 행안부 주민등록 인구·세대 (행정동) ---------- */
function findRecord(node, depth) {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findRecord(n, depth + 1); if (r) return r; } return null; }
  if (typeof node === 'object') {
    const keys = Object.keys(node);
    if (keys.some(k => /^tot/i.test(k)) && keys.some(k => /^hh/i.test(k))) return node;
    for (const k of keys) { const r = findRecord(node[k], depth + 1); if (r) return r; }
  }
  return null;
}
const pickKey = (obj, re) => { const k = Object.keys(obj).find(x => re.test(x)); return k ? obj[k] : undefined; };
function recentMonths(n, now) {
  const d = now ? new Date(now) : new Date(); const out = [];
  for (let i = 1; i <= n; i++) { const t = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(t.getFullYear() + String(t.getMonth() + 1).padStart(2, '0')); }
  return out;
}
async function population(q, env) {
  need(env, ['DATA_GO_KR_KEY'], '공공데이터포털');
  const hcode = (q.get('hcode') || '').replace(/[^0-9]/g, '');
  if (hcode.length !== 10) throw new ApiError(400, 'BAD_REQUEST', 'hcode(행정동코드 10자리)가 필요합니다');
  const url = env.POPULATION_API_URL || base(env, 'DATAGO_BASE') + '/1741000/admmSexdAgePpltn/selectAdmmSexdAgePpltn';
  const key = /%[0-9A-Fa-f]{2}/.test(env.DATA_GO_KR_KEY) ? env.DATA_GO_KR_KEY : encodeURIComponent(env.DATA_GO_KR_KEY);
  let lastErr = null;
  for (const ym of recentMonths(3)) {
    const full = url + '?serviceKey=' + key + '&admmCd=' + hcode + '&srchFrYm=' + ym + '&srchToYm=' + ym + '&lv=3&type=JSON&numOfRows=10&pageNo=1';
    let data;
    try { data = await fetchJson(full, {}, '행안부 인구통계'); } catch (e) { lastErr = e; continue; }
    const rec = findRecord(data, 0);
    if (!rec) { lastErr = new ApiError(502, 'NO_DATA', ym + ' 기준 인구 데이터가 없습니다'); continue; }
    const total = num(pickKey(rec, /^tot.*(nmpr|pop|cnt)/i)), hh = num(pickKey(rec, /^hh.*cnt|^hhCnt/i));
    if (!total) { lastErr = new ApiError(502, 'PARSE', '인구 응답 필드를 해석하지 못했습니다 (keys: ' + Object.keys(rec).join(',') + ')'); continue; }
    return { hcode, ym, total, households: hh, name: String(pickKey(rec, /dongNm|admmNm|name/i) || '') };
  }
  throw lastErr || new ApiError(502, 'NO_DATA', '인구 데이터를 가져오지 못했습니다');
}

function health(q, env) {
  return {
    ok: true,
    configured: {
      kakao: !!env.KAKAO_REST_KEY,
      naverSearch: !!(env.NAVER_CLIENT_ID && env.NAVER_CLIENT_SECRET),
      naverSearchAd: !!(env.NAVER_SEARCHAD_CUSTOMER_ID && env.NAVER_SEARCHAD_API_KEY && env.NAVER_SEARCHAD_SECRET),
      dataGoKr: !!env.DATA_GO_KR_KEY
    },
    endpoints: ['geocode', 'places', 'nts', 'keywords', 'blog', 'population'],
    time: new Date().toISOString()
  };
}

const ROUTES = { '/api/health': health, '/api/geocode': geocode, '/api/places': places, '/api/nts': nts, '/api/keywords': keywords, '/api/blog': blog, '/api/population': population };

export async function handleApi(request, env) {
  env = env || {};
  const cors = corsHeaders(request, env);
  if (cors === null) return json({ error: { code: 'FORBIDDEN_ORIGIN', message: '허용되지 않은 Origin입니다' } }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'GET') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GET만 지원합니다' } }, 405, cors);
  const url = new URL(request.url);
  const route = ROUTES[url.pathname.replace(/\/+$/, '')];
  if (!route) return json({ error: { code: 'NOT_FOUND', message: '알 수 없는 경로입니다' } }, 404, cors);
  try {
    return json(await route(url.searchParams, env), 200, cors);
  } catch (e) {
    if (e instanceof ApiError) return json({ error: { code: e.code, message: e.message } }, e.status, cors);
    return json({ error: { code: 'INTERNAL', message: String(e && e.message || e) } }, 500, cors);
  }
}
