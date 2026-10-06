# Measure · ABC 악보 연습실

ABC 코드를 직접 입력하거나 .abc 파일을 가져와 악보를 그리고 연습하는 정적 웹 앱입니다. 기본은 브라우저 저장이며, Supabase 설정을 추가하면 공유 DB에 저장합니다. 로그인·스캔 인식·AI 키는 사용하지 않습니다.

## 개발·실행

Node.js 22 이상에서:

```sh
npm ci
npm start
```

`npm start`는 dist를 빌드하고 기본 포트 3000에서 로컬 정적 서버를 실행합니다. `PORT=3001 npm start`로 포트를 바꿀 수 있습니다. `npm run build`만 실행하면 정적 사이트가 dist에 생성됩니다.

## Vercel 배포

1. Vercel의 Add New → Project에서 `wpsy99-star/metronome`을 Import합니다.
2. 배포 브랜치는 `main`, Root Directory는 `./`, Framework Preset은 **Other**입니다.
3. Build Command는 **npm run build**, Output Directory는 **dist**입니다. 저장소의 vercel.json에도 설정되어 있습니다.
4. Install Command는 기본값을 사용합니다. 브라우저 저장에는 환경 변수가 필요 없으며 Supabase 저장은 아래 두 변수를 추가합니다.
5. Deploy 후 Vercel이 제공한 주소에서 사용합니다. 이미 프로젝트를 만들었다면 새 커밋의 배포 결과를 확인하세요.

## 사용 방법

- ABC 직접 입력 또는 ABC 파일 가져오기(UTF-8, 최대 500KB, 한 파일에 한 곡).
- ABC 코드를 편집하면 악보가 자동 갱신됩니다. 변경사항 저장으로 현재 브라우저에 보관합니다.
- 음표를 클릭하면 해당 위치부터 선택한 악기 소리로 재생하며 현재 음표를 주황색으로 표시합니다.
- BPM 30–240(4분음표 기준), 일시정지·다시 재생·처음으로 이동, 메트로놈 소리.
- 왼쪽에는 최근 등록 5개, 내 악보에서는 전체 목록·제목 검색·삭제.
- ABC 내보내기로 악보를 파일로 보관하거나 다른 브라우저로 옮길 수 있습니다.

## 저장 범위

Supabase를 설정하지 않은 경우 localStorage의 `measure.scores.v1`에 제목, ABC, BPM, 등록·수정 시각을 저장합니다. 같은 주소·같은 브라우저에서만 유지됩니다. 다른 기기, 다른 Vercel 미리보기 주소와 자동으로 공유되지 않습니다. 사이트 데이터 삭제 또는 시크릿 창 종료 시 악보가 사라질 수 있으므로 중요한 악보는 ABC 파일로 내보내세요. 저장 실패는 안내하고 편집 내용을 유지합니다. 과거 SQLite DB는 자동 이전하지 않습니다.

연습 설정에서 피아노 또는 B♭ 클라리넷을 선택합니다. 피아노는 악보 그대로, B♭ 클라리넷은 한 음(2반음) 낮춰 클라리넷 음색으로 재생합니다. 악보와 음표 색상 위치는 그대로 유지합니다. 실제 재생 음높이 A0–C8 범위를 지원합니다. 악기 선택은 현재 브라우저에 보관하며 악보 DB 설정과는 독립적입니다. 음원과 abcjs는 정적 파일로 포함되어 외부 음원 API 요청 없이 재생됩니다. 오디오 재생은 사용자의 클릭으로 시작합니다.

## 검증

```sh
npm run build
npm test
```

Playwright 브라우저 테스트는 `/usr/bin/chromium`을 사용합니다. 다른 환경에서는 CHROMIUM_PATH로 설치된 Chromium 경로를 지정하세요. 테스트는 별도 브라우저 컨텍스트로 저장 데이터를 격리하며 ABC 편집·저장·새로고침 복원·목록·삭제, 파일 가져오기·내보내기, 저장 실패, 실제 오디오 데이터·음표 클릭 재생 및 6/8 박자의 시간을 검증합니다.

`ui/`는 이전 디자인 시안입니다. 실제 앱은 `public/`이며 Vercel에는 `dist/`가 배포됩니다.

## 외부 구성요소

abcjs는 MIT 라이선스입니다. FluidR3_GM 피아노 음원은 Frank Wen의 Soundfont를 MIDI.js MP3로 변환한 CC BY 3.0 US 자료입니다. 출처는 `public/soundfonts/LICENSE.txt`를 참고하세요.

## Supabase 연결

필요한 것은 **프로젝트 URL**과 **publishable key**(legacy anon key도 지원)입니다. Supabase 대시보드의 Project Settings → Data API에서 URL을, API Keys에서 키를 확인하세요. `service_role`, `sb_secret_` 키는 사용하지 마세요. 빌드 시 이러한 키는 거부됩니다. URL과 키는 공개 정적 파일에 포함되므로 publishable/anon 키만 허용합니다.

1. Supabase 프로젝트에서 SQL Editor를 열고 `supabase/schema.sql`의 내용을 실행합니다. `public.measure_scores` 테이블, RLS 정책, 수정 시각 트리거가 생성됩니다. 같은 SQL을 다시 실행할 수 있습니다.
2. Vercel 프로젝트의 Settings → Environment Variables에 두 값을 등록합니다.
   - `SUPABASE_URL`: 프로젝트의 HTTPS URL
   - `SUPABASE_PUBLISHABLE_KEY`: publishable key 또는 legacy anon key
3. 사용할 Production/Preview 환경에 적용하고 **Redeploy**합니다. 설정은 빌드에 포함되므로 변수 변경 후 재배포가 필요합니다.
4. 화면의 ‘Supabase 공유 저장’을 확인한 뒤 악보를 저장합니다. Supabase Table Editor의 measure_scores에서 저장 결과를 확인할 수 있습니다.

로컬에서는 `.env.example`을 `.env.local`로 복사해 값을 넣고 `npm start`합니다. 두 변수 모두 없으면 기존 브라우저 저장을 사용합니다. 하나만 설정하면 빌드가 실패합니다. 연결 실패 시 브라우저 저장으로 자동 전환하지 않고 오류를 표시해 저장 위치를 명확하게 유지합니다.

**로그인 없는 공유 목록**입니다. SQL의 anon 정책은 모든 접속자에게 읽기·등록·수정·삭제 권한을 줍니다. 개인별 비공개 악보에는 로그인 및 소유자별 RLS가 필요합니다. 기존 브라우저 악보는 자동 업로드하지 않습니다. 연결 전에 ABC로 내보낸 후 연결된 사이트에서 가져오기·저장하세요.

Supabase CRUD와 권한 오류는 테스트에서 응답을 모의하여 검증합니다. 실제 프로젝트의 연결·SQL 실행은 사용자 설정 후 확인해야 합니다.
