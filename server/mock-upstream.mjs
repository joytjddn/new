/**
 * 테스트용 모의 업스트림 (카카오·네이버·국세청·행안부). 실제 API 응답 형식을 따라 만든 가짜 서버입니다.
 * 직접 실행: node server/mock-upstream.mjs  (PORT 기본 9911)
 */
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';

export const MOCK_KEYS = { kakao: 'KAK', naverId: 'NID', naverSecret: 'NSEC', adCustomer: '123456', adKey: 'ADKEY', adSecret: 'ADSECRET', dataGo: 'DGKEY' };
export const calls = [];

export function startMock(port) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body });
      const send = (obj, status) => { res.writeHead(status || 200, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
      const p = url.pathname;

      if (p === '/v2/local/search/address.json') {
        if (req.headers.authorization !== 'KakaoAK ' + MOCK_KEYS.kakao) return send({ errorType: 'AccessDeniedError', message: 'wrong appKey' }, 401);
        if (url.searchParams.get('query').includes('없는주소')) return send({ documents: [], meta: { total_count: 0 } });
        return send({ meta: { total_count: 1 }, documents: [{ address_name: '경기 의정부시 신곡동 100', address_type: 'ROAD_ADDR', x: '127.0623', y: '37.7500',
          address: { region_1depth_name: '경기', region_2depth_name: '의정부시', region_3depth_name: '신곡동', region_3depth_h_name: '신곡1동', h_code: '4115056000', b_code: '4115010100' },
          road_address: { road_name: '추동로1번길', region_1depth_name: '경기', region_2depth_name: '의정부시', region_3depth_name: '신곡동' } }] });
      }
      if (p === '/v2/local/search/keyword.json') {
        if ((url.searchParams.get('query') || '').includes('없는주소')) return send({ documents: [], meta: { total_count: 0 } });
        const r = +url.searchParams.get('radius') || 0;
        const total = r <= 500 ? 12 : r <= 1000 ? 41 : 133;
        return send({ meta: { total_count: total }, documents: [
          { id: '1', place_name: '낙곱새마을 의정부점', distance: '120', road_address_name: '경기 의정부시 추동로 10', category_name: '음식점 > 한식', phone: '031-111-2222' },
          { id: '2', place_name: '국민낙곱새 의정부점', distance: '5', road_address_name: '경기 의정부시 추동로1번길 32', category_name: '음식점 > 한식', phone: '' },
          { id: '3', place_name: '신곡 곱창전골', distance: '310', address_name: '경기 의정부시 신곡동 22', category_name: '음식점 > 한식', phone: '' },
          { id: '4', place_name: '낙곱새마을 의정부점', distance: '330', address_name: '중복', category_name: '', phone: '' },
          { id: '5', place_name: '동오 낙지공방', distance: '540', address_name: '경기 의정부시 동오동 1', category_name: '음식점 > 한식', phone: '' }
        ] });
      }
      if (p === '/api/nts-businessman/v1/status') {
        if (url.searchParams.get('serviceKey') !== MOCK_KEYS.dataGo) return send({ code: -401, msg: '인증키 오류' }, 401);
        const b = JSON.parse(body).b_no[0];
        if (b === '9999999999') return send({ status_code: 'OK', data: [{ b_no: b, b_stt: '', b_stt_cd: '', tax_type: '국세청에 등록되지 않은 사업자등록번호입니다.', tax_type_cd: '' }] });
        if (b === '2222222222') return send({ status_code: 'OK', data: [{ b_no: b, b_stt: '폐업자', b_stt_cd: '03', tax_type: '부가가치세 일반과세자', tax_type_cd: '01', end_dt: '20250930' }] });
        return send({ status_code: 'OK', data: [{ b_no: b, b_stt: '계속사업자', b_stt_cd: '01', tax_type: '부가가치세 일반과세자', tax_type_cd: '01', end_dt: '' }] });
      }
      if (p === '/keywordstool') {
        const h = req.headers;
        const expected = createHmac('sha256', MOCK_KEYS.adSecret).update(h['x-timestamp'] + '.GET./keywordstool').digest('base64');
        if (h['x-api-key'] !== MOCK_KEYS.adKey || h['x-customer'] !== MOCK_KEYS.adCustomer || h['x-signature'] !== expected) return send({ title: 'Invalid Signature', status: 403 }, 403);
        const hints = (url.searchParams.get('hintKeywords') || '').split(',');
        const list = [];
        hints.forEach((k, i) => { if (k !== '없는키워드') list.push({ relKeyword: k, monthlyPcQcCnt: 300 + i * 100, monthlyMobileQcCnt: i === 1 ? '< 10' : 2000 + i * 500, monthlyAvePcClkCnt: 5.5, monthlyAveMobileClkCnt: 40.2, compIdx: '높음', plAvgDepth: 4 + i }); });
        list.push({ relKeyword: '연관키워드', monthlyPcQcCnt: 1, monthlyMobileQcCnt: 1, compIdx: '낮음', plAvgDepth: 0 });
        return send({ keywordList: list });
      }
      if (p === '/v1/search/blog.json') {
        if (req.headers['x-naver-client-id'] !== MOCK_KEYS.naverId || req.headers['x-naver-client-secret'] !== MOCK_KEYS.naverSecret) return send({ errorCode: '024', errorMessage: 'Authentication failed' }, 401);
        const q = url.searchParams.get('query');
        return send({ total: q.includes('낙곱새마을') ? 8123 : q.includes('국민낙곱새') ? 1530 : 420, items: [] });
      }
      if (p === '/1741000/admmSexdAgePpltn/selectAdmmSexdAgePpltn') {
        if (url.searchParams.get('serviceKey') !== MOCK_KEYS.dataGo) return send({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' } } });
        const ym = url.searchParams.get('srchFrYm');
        if (url.searchParams.get('admmCd') === '0000000000') return send({ Response: { head: { resultCode: 'INFO-200' }, items: { item: [] } } });
        const latest = calls.filter(c => c.path === p).length;
        if (latest === 1 && url.searchParams.get('admmCd') === '1111111111') return send({ Response: { items: { item: [] } } });
        return send({ Response: { head: { resultCode: 'INFO-000' }, items: { item: [{ statsYm: ym, admmCd: url.searchParams.get('admmCd'), dongNm: '신곡1동', totNmprCnt: '16,820', hhCnt: '7,310', maleNmprCnt: 8400, femlNmprCnt: 8420 }] } } });
      }
      send({ error: 'not found', path: p }, 404);
    });
  });
  return new Promise(resolve => server.listen(port || 0, () => resolve(server)));
}

if (process.argv[1] && process.argv[1].endsWith('mock-upstream.mjs')) {
  const s = await startMock(Number(process.env.PORT || 9911));
  console.log('mock upstream on', s.address().port);
}
