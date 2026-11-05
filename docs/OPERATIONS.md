# Azure Static Web Apps 운영

## 배포 대상

- 프런트엔드: `dist/` (React/Vite/PWA).
- API: `api/host.json`, `api/package.json`, `api/dist/`, 운영 의존성. SWA 기본 관리형 Azure Functions, Node.js 22, HTTP 트리거 하나로 `/api/*` 처리.
- 저장: Azure Blob Storage의 **비공개** `game-state` 컨테이너. `rooms/` 방, `races/` 경주, `limits/` 생성·입장 제한.
- 알림: Azure Web PubSub의 `game` 허브. 서버만 변경 알림을 보내며, 참가자는 허용된 방의 알림만 받습니다. 정답·세션·전체 경주 경로는 알림에 포함되지 않습니다.
- App Service, Socket.IO, Azure Table Storage는 사용하지 않습니다. SWA 기본 API는 HTTP만 지원하므로 API 안에 상시 타이머나 WebSocket 서버를 띄우지 않습니다.

## 기존 SWA에 필요한 설정

Azure Portal에서 **Static Web Apps → Environment variables**에 다음 API 설정을 넣습니다. 빌드용 `VITE_` 변수나 Git에 넣지 마세요.

| 이름 | 값 |
| --- | --- |
| `GAME_STORAGE_CONNECTION_STRING` | Storage Account의 연결 문자열. 비공개 Blob 생성/읽기/쓰기 권한 필요 |
| `WEB_PUBSUB_CONNECTION_STRING` | Web PubSub 리소스의 Keys에서 얻은 연결 문자열 |
| `SESSION_SECRET` | 직접 생성한 32자 이상의 무작위 비밀값. 재배포 때도 같은 값 유지 |
| `APP_ORIGIN` (선택) | 정확히 한 도메인만 허용하려면 `https://...azurestaticapps.net`. 여러 사용자 도메인/미리보기 환경이면 생략 |

필수값이 빠지면 `/api/health`와 방 기능이 503으로 설정 오류를 반환합니다. 설정 없는 운영 환경에서 로컬 파일이나 메모리로 대체하지 않습니다. `/api/health`의 200은 패키지/설정 준비 상태이며 실제 Azure 자원의 권한·통신 검증은 방 생성으로 확인합니다.

Storage 컨테이너는 첫 요청 때 비공개로 생성됩니다. Web PubSub의 허브용 이벤트 처리기나 클라이언트 전송 권한은 설정할 필요가 없습니다. 토큰에 방 그룹이 미리 지정되며 API가 게임 입력을 판정합니다.

SWA Free 플랜에서도 이 API 구조를 사용할 수 있습니다. Storage/Web PubSub는 별도 리소스입니다. Web PubSub Free는 전체 서비스에서 동시 연결 20개와 일일 메시지 제한이 있으므로, 30명 또는 여러 방의 원활한 실시간 알림에는 Standard 용량을 선택하세요. 한도 초과/알림 장애 시에는 HTTP 동기화로 이어지지만 지연이 늘 수 있습니다. 비용과 리전 제공 여부는 계정에서 확인합니다.

## GitHub 연결

1. 저장소 Secret **`AZURE_STATIC_WEB_APPS_API_TOKEN`**에 대상 SWA의 배포 토큰을 저장합니다.
2. `deploy.yml`의 **Test and build**가 Node 22로 빌드, 전체 자동 검사, 모바일 브라우저 검사를 수행하고 `swa-package`를 만듭니다.
3. main의 push 검사가 성공하면 같은 workflow의 `deploy` 단계가 그 실행의 산출물을 내려받아 배포합니다. 토큰이 없으면 배포 단계는 건너뛰며 CI만 수행됩니다.
4. 배포 입력은 `app_location: dist`, `api_location: api`, `skip_app_build: true`, `skip_api_build: true`, `output_location: ''`입니다. API 폴더를 생략하면 화면만 올라가므로 반드시 포함해야 합니다.
5. Portal에서 GitHub 연결할 때 Azure가 만든 별도 workflow와 이 workflow를 동시에 사용하지 마세요. 하나의 배포 workflow만 활성화합니다. 토큰 이름이 자동 생성된 긴 이름이면 위 Secret 이름에 맞추거나 `deploy.yml`의 참조를 변경합니다.

미리보기 환경 자동 배포는 현재 workflow에 포함하지 않습니다. 추가할 때에는 미리보기 전용 Storage, PubSub, SESSION_SECRET을 사용해 운영 방과 분리하세요.

## 새 Azure 자원

`infra/main.bicep`은 SWA Free + Storage LRS + Web PubSub를 만듭니다. 필요한 매개변수는 `appName`, `storageName`, `pubsubName`, `sessionSecret`, 지원되는 `location`입니다. Web PubSub는 기본 `Free_F1`, 운영 규모에 따라 `pubsubSku=Standard_S1`을 선택합니다. 실제 리소스 생성은 사용자 Azure 계정에서 실행해야 합니다.

템플릿은 API 설정을 연결하고, `game-state/`에서 3일 이상 변경되지 않은 Blob을 지우는 수명 주기를 설정합니다. **기존 자원을 연결하면 이 수명 주기를 별도로 적용하세요.** API는 만료된 방 접근을 차단하지만 SWA HTTP 함수 자체가 주기적으로 파일을 삭제하지는 않습니다. 이 템플릿은 새 자원용이므로 기존 SWA에 적용하기 전 설정 보존 여부를 확인하세요.

## 게임과 복구 규칙

- 로그인 없이 서명된 HttpOnly/Secure/SameSite 쿠키로 참가자 신원을 유지합니다. 같은 브라우저와 도메인에서 재입장하면 같은 참가자가 됩니다. 쿠키 삭제, 시크릿 모드 또는 다른 브라우저는 다른 참가자입니다.
- 방은 최대 30명, 각 게임별 제한은 화면에 표시됩니다. 손가락 터치는 한 기기 전용입니다. 시작 후 입장자는 해당 판의 관전자입니다.
- 모든 참가자가 준비하고 화면 로딩을 알리면 공통 서버 시각으로 3초 뒤 시작합니다. 서버가 차례·기한·배치·판정을 결정합니다. 클라이언트는 현재 공개 상태만 받습니다.
- Blob의 ETag를 조건으로 저장합니다. 여러 함수가 동시에 호출되면 최신 상태로 재시도하므로 이전 상태를 덮어쓰지 않습니다. 동일 요청 ID의 재전송은 중복 반영하지 않습니다. 저장 성공 뒤에만 알립니다.
- 콜드 스타트/재배포는 방을 초기화하지 않습니다. 저장된 방을 매 요청에서 읽습니다. 큰 경주 데이터만 변경 불가능한 값으로 짧게 캐시합니다.
- Web PubSub는 변경 알림을 전달합니다. 알림 유실/중단 시에도 로비 약 1.5초, 게임 약 0.5초 간격의 HTTP 요청으로 복구합니다. 요청 처리 시간/네트워크 지연은 이 간격에 추가됩니다. 경주 화면은 현재 좌표만 받습니다.
- 기한이 지나면 **다음 API 요청에서** 자동 진행을 확정합니다. 아무도 접속하지 않은 동안 백그라운드로 게임을 계속 계산하지 않습니다. 모두 복귀하면 경과 시간을 먼저 검사합니다.
- 20초간 응답이 없는 참가자는 연결 끊김으로 판단하고, 그 뒤 60초간 방장이 돌아오지 않으면 접속 중인 참가자에게 위임합니다. 전원 부재 10분 또는 유효 활동 2시간 없음은 종료 조건입니다. 완료 기록은 24시간/최대 50판입니다.
- 한 참가자의 여러 탭 중 조작권은 하나만 가집니다. 다른 탭은 `이 화면에서 조작하기`로 인수합니다. 연결이 끊긴 탭의 조작권은 새 입장에서 회수할 수 있습니다.
- 10초 맞추기는 휴대폰의 로컬 경과 시간으로 측정하고 서버에서 허용 범위를 검사합니다. 동점은 한 번 재경기, 다시 동점이면 사전 추첨 순서를 사용합니다. 브라우저 조작까지 막는 금전 베팅용 부정 방지 시스템은 아닙니다.
- API는 JSON·전용 요청 헤더·쿠키를 요구하고 외부 출처의 브라우저 요청을 거절합니다. 방 생성은 세션당 시간당 6회, 입장은 분당 30회로 제한합니다. 대규모 공개 운영 전에는 서비스 규모에 맞는 트래픽 제한과 비용 관찰을 추가하세요.

## 로컬 실행과 검증

```bash
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:e2e
npm start
```

`npm start`/`npm run dev`는 동일 API 처리 코드를 로컬 HTTP 서버에서 실행합니다. 키를 넣지 않은 로컬 모드에서만 `.data/swa`에 저장하고 HTTP 동기화를 사용합니다. 같은 Wi-Fi의 휴대폰은 PC의 LAN 주소로 접속할 수 있습니다. PC 방화벽과 네트워크의 장치 격리 여부를 확인하세요.

Azure Functions Core Tools가 있다면 `npm run build:api` 후 `api/`에서 `func start`로 실제 함수 패키지를 실행할 수 있습니다. `FUNCTIONS_WORKER_RUNTIME=node` 및 위 API 설정, 로컬 실행용 `AzureWebJobsStorage`를 환경에 제공합니다. `node scripts/smoke-functions.mjs`는 기본 `http://127.0.0.1:7071`에 세 독립 세션으로 방을 만들고 사다리의 같은 결과와 토큰 발급을 검사합니다. `FUNCTIONS_TEST_URL`로 대상 호스트를 지정할 수 있으며 테스트 방 1개가 생성됩니다.

`TEST_AZURITE=1 npm test`는 Blob 에뮬레이터 통합 검사도 실행합니다. Windows PowerShell에서는 먼저 `$env:TEST_AZURITE='1'`을 설정하세요. 테스트용 Azurite 계정은 `gametest`, 키는 바이트 1~32를 Base64로 바꾼 공개 테스트 값, Blob 포트는 11000입니다. 운영 자격 증명은 테스트에 사용하지 않습니다.

검증 범위: 9종 게임 규칙, 여러 함수의 동시 준비/중복 요청, 공개 정보 보호, 타임아웃/방장 위임/복구, 실제 Blob 조건부 저장, 모바일 크기의 독립 브라우저에서 9종 완료·새로고침·통신 복구·탭 제어. 실제 Azure 서비스와 물리 휴대폰은 배포 후 별도로 확인해야 합니다.

## 배포 후 짧은 확인

- `/api/health`가 JSON 200인지 확인합니다. HTML이면 API 배포 경로가 빠진 것입니다.
- 서로 다른 실제 휴대폰으로 같은 초대 링크에 들어가 준비→시작→결과가 같은지 확인합니다.
- 한 폰의 통신을 잠시 끊었다 연결하고 같은 참가자로 돌아오는지 확인합니다.
- `/api/rooms/{code}/negotiate`가 Web PubSub URL을 반환하고 브라우저에서 WebSocket이 연결되는지 확인합니다. URL에는 단기 토큰이 있으므로 공유하거나 로그에 남기지 마세요.
- 화면만 나오고 방 생성이 실패하면 API 환경 변수, Storage 연결 문자열/권한, PubSub 연결 문자열부터 확인합니다.

## 참고한 공식 문서

- [SWA API 제한: HTTP 전용, 최대 45초](https://learn.microsoft.com/en-us/azure/static-web-apps/apis-overview)
- [SWA 구성과 Node 22 런타임](https://learn.microsoft.com/en-us/azure/static-web-apps/configuration)
- [미리 빌드한 화면/API 배포](https://learn.microsoft.com/en-us/azure/static-web-apps/build-configuration)
- [Web PubSub JSON 프로토콜 및 권한](https://learn.microsoft.com/en-us/azure/azure-web-pubsub/reference-json-webpubsub-subprotocol)
- [Azure Web PubSub 연결/메시지 한도](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/azure-subscription-service-limits#azure-web-pubsub-limits)
