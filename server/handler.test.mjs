import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from './handler.js';
import { startMock, MOCK_KEYS, calls } from './mock-upstream.mjs';

let server, env;
const get = (path, headers) => handleApi(new Request('http://proxy.test' + path, { headers: headers || {} }), env);
const body = async res => ({ status: res.status, data: await res.json() });

before(async () => {
  server = await startMock(0);
  const b = 'http://127.0.0.1:' + server.address().port;
  env = {
    KAKAO_REST_KEY: MOCK_KEYS.kakao, NAVER_CLIENT_ID: MOCK_KEYS.naverId, NAVER_CLIENT_SECRET: MOCK_KEYS.naverSecret,
    NAVER_SEARCHAD_CUSTOMER_ID: MOCK_KEYS.adCustomer, NAVER_SEARCHAD_API_KEY: MOCK_KEYS.adKey, NAVER_SEARCHAD_SECRET: MOCK_KEYS.adSecret, DATA_GO_KR_KEY: MOCK_KEYS.dataGo,
    KAKAO_BASE: b, NAVER_OPEN_BASE: b, SEARCHAD_BASE: b, ODCLOUD_BASE: b, DATAGO_BASE: b
  };
});
after(() => server.close());

test('health 는 설정된 키만 true 로 보고한다', async () => {
  const { data } = await body(await get('/api/health'));
  assert.equal(data.ok, true);
  assert.deepEqual(data.configured, { kakao: true, naverSearch: true, naverSearchAd: true, dataGoKr: true });
  const empty = await handleApi(new Request('http://proxy.test/api/health'), {});
  assert.deepEqual((await empty.json()).configured, { kakao: false, naverSearch: false, naverSearchAd: false, dataGoKr: false });
});

test('키가 없으면 501 NOT_CONFIGURED', async () => {
  for (const p of ['/api/geocode?q=a', '/api/places?q=a&x=1&y=1', '/api/nts?bno=1234567890', '/api/keywords?kw=a', '/api/blog?q=a', '/api/population?hcode=1234567890']) {
    const res = await handleApi(new Request('http://proxy.test' + p), {});
    const { status, data } = await body(res);
    assert.equal(status, 501, p); assert.equal(data.error.code, 'NOT_CONFIGURED', p);
  }
});

test('geocode: 좌표·행정동·법정동·코드를 정규화한다', async () => {
  const { status, data } = await body(await get('/api/geocode?q=' + encodeURIComponent('경기도 의정부시 추동로1번길 32')));
  assert.equal(status, 200);
  assert.equal(data.x, 127.0623); assert.equal(data.y, 37.75);
  assert.equal(data.r1, '경기'); assert.equal(data.r2, '의정부시');
  assert.equal(data.hdong, '신곡1동'); assert.equal(data.bdong, '신곡동'); assert.equal(data.hcode, '4115056000'); assert.equal(data.road, '추동로1번길');
});

test('geocode: 주소 없음은 404, q 누락은 400, 잘못된 키는 502', async () => {
  assert.equal((await get('/api/geocode?q=' + encodeURIComponent('없는주소'))).status, 404);
  assert.equal((await get('/api/geocode')).status, 400);
  const bad = await handleApi(new Request('http://proxy.test/api/geocode?q=a'), Object.assign({}, env, { KAKAO_REST_KEY: 'WRONG' }));
  const { status, data } = await body(bad);
  assert.equal(status, 502); assert.match(data.error.message, /401/);
});

test('places: 반경별 총 업소 수와 중복·자기 자신 제거한 경쟁업체 목록', async () => {
  const { status, data } = await body(await get('/api/places?q=' + encodeURIComponent('낙곱새') + '&x=127.06&y=37.75&exclude=' + encodeURIComponent('국민낙곱새 의정부점')));
  assert.equal(status, 200);
  assert.deepEqual(data.counts, { 500: 12, 1000: 41, 2000: 133 });
  const names = data.top.map(t => t.name);
  assert.deepEqual(names, ['낙곱새마을 의정부점', '신곡 곱창전골', '동오 낙지공방']);
  assert.equal(data.top[0].distance, 120);
  assert.equal((await get('/api/places?q=a')).status, 400);
});

test('nts: 계속사업자 / 폐업자 / 미등록 번호', async () => {
  let r = (await body(await get('/api/nts?bno=123-45-67890'))).data;
  assert.equal(r.bno, '1234567890'); assert.equal(r.registered, true); assert.equal(r.status, '계속사업자'); assert.equal(r.taxType, '부가가치세 일반과세자');
  r = (await body(await get('/api/nts?bno=2222222222'))).data;
  assert.equal(r.status, '폐업자'); assert.equal(r.endDate, '20250930');
  r = (await body(await get('/api/nts?bno=9999999999'))).data;
  assert.equal(r.registered, false); assert.match(r.message, /등록되지 않은/);
  assert.equal((await get('/api/nts?bno=123')).status, 400);
});

test('keywords: HMAC 서명 헤더로 호출하고 공백 제거 키워드로 정확 매칭, "< 10" 은 5 로 환산', async () => {
  const before = calls.length;
  const { status, data } = await body(await get('/api/keywords?kw=' + encodeURIComponent('의정부 낙곱새,신곡동 맛집,없는키워드')));
  assert.equal(status, 200);
  const call = calls.slice(before).find(c => c.path === '/keywordstool');
  assert.ok(call.headers['x-signature']); assert.equal(call.query.hintKeywords, '의정부낙곱새,신곡동맛집,없는키워드');
  assert.deepEqual(data.items.map(i => i.kw), ['의정부낙곱새', '신곡동맛집']);
  assert.equal(data.items[0].pc, 300); assert.equal(data.items[0].mobile, 2000); assert.equal(data.items[0].total, 2300);
  assert.equal(data.items[1].mobile, 5); assert.equal(data.items[0].plAvgDepth, 4); assert.equal(data.items[0].compIdx, '높음');
  assert.deepEqual(data.notFound, ['없는키워드']);
});

test('keywords: 5개 초과 키워드는 5개씩 나누어 호출', async () => {
  const before = calls.length;
  const kws = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7'].join(',');
  const { data } = await body(await get('/api/keywords?kw=' + kws));
  assert.equal(data.items.length, 7);
  assert.equal(calls.slice(before).filter(c => c.path === '/keywordstool').length, 2);
});

test('blog: 여러 검색어의 total', async () => {
  const { data } = await body(await get('/api/blog?q=' + encodeURIComponent('"국민낙곱새"') + '&q=' + encodeURIComponent('"낙곱새마을"')));
  assert.deepEqual(data.items.map(i => i.total), [1530, 8123]);
  assert.equal((await get('/api/blog')).status, 400);
});

test('population: 숫자 파싱(쉼표), 데이터 없는 달은 건너뜀', async () => {
  const { status, data } = await body(await get('/api/population?hcode=4115056000'));
  assert.equal(status, 200);
  assert.equal(data.total, 16820); assert.equal(data.households, 7310); assert.equal(data.name, '신곡1동'); assert.match(data.ym, /^\d{6}$/);
  assert.equal((await get('/api/population?hcode=12')).status, 400);
  const none = await get('/api/population?hcode=0000000000');
  assert.equal(none.status, 502);
});

test('CORS: 기본 *, 제한 시 허용 Origin 만', async () => {
  let res = await get('/api/health', { origin: 'https://a.example' });
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const restricted = Object.assign({}, env, { ALLOWED_ORIGINS: 'https://ok.example' });
  res = await handleApi(new Request('http://proxy.test/api/health', { headers: { origin: 'https://ok.example' } }), restricted);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://ok.example');
  res = await handleApi(new Request('http://proxy.test/api/health', { headers: { origin: 'https://evil.example' } }), restricted);
  assert.equal(res.status, 403);
  res = await handleApi(new Request('http://proxy.test/api/health', { method: 'OPTIONS', headers: { origin: 'https://ok.example' } }), restricted);
  assert.equal(res.status, 204);
});

test('알 수 없는 경로 404, POST 405', async () => {
  assert.equal((await get('/api/nope')).status, 404);
  assert.equal((await handleApi(new Request('http://proxy.test/api/health', { method: 'POST' }), env)).status, 405);
});
