# Measure · ABC 악보 연습실

ABC 코드를 직접 입력하거나 .abc 파일을 가져와 악보를 그리고 연습하는 정적 웹 앱입니다. 로그인, 서버 API, DB, 스캔 인식, AI 키가 필요하지 않습니다.

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
4. Install Command는 기본값을 사용합니다. 환경 변수는 필요하지 않습니다.
5. Deploy 후 Vercel이 제공한 주소에서 사용합니다. 이미 프로젝트를 만들었다면 새 커밋의 배포 결과를 확인하세요.

## 사용 방법

- ABC 직접 입력 또는 ABC 파일 가져오기(UTF-8, 최대 500KB, 한 파일에 한 곡).
- ABC 코드를 편집하면 악보가 자동 갱신됩니다. 변경사항 저장으로 현재 브라우저에 보관합니다.
- 음표를 클릭하면 해당 위치부터 피아노 소리로 재생하며 현재 음표를 주황색으로 표시합니다.
- BPM 30–240(4분음표 기준), 일시정지·다시 재생·처음으로 이동, 메트로놈 소리.
- 왼쪽에는 최근 등록 5개, 내 악보에서는 전체 목록·제목 검색·삭제.
- ABC 내보내기로 악보를 파일로 보관하거나 다른 브라우저로 옮길 수 있습니다.

## 저장 범위

localStorage의 `measure.scores.v1`에 제목, ABC, BPM, 등록·수정 시각을 저장합니다. 같은 주소·같은 브라우저에서만 유지됩니다. 다른 기기, 다른 Vercel 미리보기 주소와 자동으로 공유되지 않습니다. 사이트 데이터 삭제 또는 시크릿 창 종료 시 악보가 사라질 수 있으므로 중요한 악보는 ABC 파일로 내보내세요. 저장 실패는 안내하고 편집 내용을 유지합니다. 과거 SQLite DB는 자동 이전하지 않습니다.

피아노 음색의 A0–C8 범위를 지원합니다. 음원과 abcjs는 정적 파일로 포함되어 외부 음원 API 요청 없이 재생됩니다. 오디오 재생은 사용자의 클릭으로 시작합니다.

## 검증

```sh
npm run build
npm test
```

Playwright 브라우저 테스트는 `/usr/bin/chromium`을 사용합니다. 다른 환경에서는 CHROMIUM_PATH로 설치된 Chromium 경로를 지정하세요. 테스트는 별도 브라우저 컨텍스트로 저장 데이터를 격리하며 ABC 편집·저장·새로고침 복원·목록·삭제, 파일 가져오기·내보내기, 저장 실패, 실제 오디오 데이터·음표 클릭 재생 및 6/8 박자의 시간을 검증합니다.

`ui/`는 이전 디자인 시안입니다. 실제 앱은 `public/`이며 Vercel에는 `dist/`가 배포됩니다.

## 외부 구성요소

abcjs는 MIT 라이선스입니다. FluidR3_GM 피아노 음원은 Frank Wen의 Soundfont를 MIDI.js MP3로 변환한 CC BY 3.0 US 자료입니다. 출처는 `public/soundfonts/LICENSE.txt`를 참고하세요.
