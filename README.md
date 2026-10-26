# 온라인 마케팅 종합 진단서 생성기

`index.html` 한 파일로 동작하는 A4 15페이지 진단서 생성기입니다. 브라우저에서 열면 바로 쓸 수 있고(수치는 모델 추정),
`server/` 프록시를 연결하면 공식 API 실측값으로 바뀝니다.

## 1. 가장 빠른 사용 (API 없이)

`index.html` 을 내려받아 브라우저로 엽니다. 모든 수치는 입력값 기반 **모델 추정**이며 진단서에도 그렇게 표시됩니다.

## 2. 로컬에서 실측 연동까지 실행

```bash
cp .env.example .env      # 키 입력
npm run dev               # http://localhost:8787
```

같은 주소에서 페이지가 열리므로 CORS 설정이 필요 없고, 입력 카드의 "실측 데이터 연동" 영역에 `API 연결됨`이 표시됩니다.

```bash
npm test                  # 프록시 단위 테스트 (모의 업스트림 사용, 실제 키 불필요)
```

## 3. 공개 URL 만들기

### 정적 페이지 (GitHub Pages)

1. 이 저장소의 **Settings → Pages → Build and deployment → Source** 를 `GitHub Actions` 로 설정
2. `main` 에 머지되면 `.github/workflows/pages.yml` 이 `index.html` 을 배포 (주소: `https://<계정>.github.io/<저장소>/`)

### API 프록시 (Cloudflare Workers)

```bash
cd server
npx wrangler secret put KAKAO_REST_KEY            # 아래 키를 하나씩 등록
npx wrangler secret put NAVER_CLIENT_ID
npx wrangler secret put NAVER_CLIENT_SECRET
npx wrangler secret put NAVER_SEARCHAD_CUSTOMER_ID
npx wrangler secret put NAVER_SEARCHAD_API_KEY
npx wrangler secret put NAVER_SEARCHAD_SECRET
npx wrangler secret put DATA_GO_KR_KEY
npx wrangler deploy
```

배포 후 `server/wrangler.toml` 의 `ALLOWED_ORIGINS` 를 Pages 주소(`https://<계정>.github.io`)로 좁히고,
페이지의 "API 서버 주소"에 Worker 주소를 입력한 뒤 **연결 확인**을 누르세요. 주소는 브라우저에 저장됩니다.
키는 서버에만 있고 `index.html` 에는 들어가지 않습니다.

## 4. 연동 항목과 한계

| 데이터 | 출처 | 상태 |
| --- | --- | --- |
| 주소 → 행정동·좌표 | 카카오 로컬 | 실측 |
| 반경 500m/1km/2km 동종 업소 수, 인근 업소명 | 카카오 로컬 키워드 검색 | 실측 (자기 업소 포함 가능) |
| 월 검색량, 광고 경쟁도 | 네이버 검색광고 키워드도구 | 실측 (도구에 없는 키워드는 추정) |
| 블로그 게시량 | 네이버 검색 API | 실측 (동명 업체·광고성 글 포함 가능) |
| 사업자 상태 | 공공데이터포털 국세청 상태조회 | 실측 (사업자번호 입력 시) |
| 행정동 인구·세대 | 행안부 주민등록 인구통계 | 실측, 단 응답 형식을 실제 키로 검증하지 못함 → 다르면 `POPULATION_API_URL` 조정 |
| 플레이스 순위, 리뷰·사진·소식·답글, 광고 집행 | 공식 API 없음 | 직접 입력 또는 추정 (입력 카드에서 입력) |
| 경쟁업체 리뷰·사진, 4대 지도 일치도 | 공식 API 없음 | 추정 |

- 반경 내 인구는 행정동 실측 인구를 기준으로 면적 비례로 추정한 값입니다.
- 종합 점수의 42~57점 · C등급 고정은 발행 규격이며, 입력 카드의 체크박스를 해제하면 실측 기반 점수 그대로 계산합니다.
- 진단서 15페이지에 항목별 `실측 / 직접 입력 / 추정 / 실패→추정` 구분표가 자동으로 들어갑니다.
- 이 저장소의 테스트는 모의 서버로만 검증했습니다. 실제 키로 처음 호출할 때는 `/api/health` 와 입력 카드의 연결 확인 메시지부터 확인하세요.
