# `dev.margins.cloud/imgym` 배포

Oh My Img는 Docker Compose로 실행하고 기존 Nginx를 통해 아래 주소에 공개합니다.

<https://dev.margins.cloud/imgym>

Next.js의 `basePath`가 `/imgym`으로 고정되어 있으므로 Nginx에서 이 경로를 제거하지 않습니다. 앱 컨테이너는 외부 포트를 직접 열지 않고 `127.0.0.1:5820`으로 연결합니다.

## 최초 1회 설정

서버에 저장소를 받습니다.

```sh
sudo install -d -o peacepiece -g peacepiece /opt/imgym
git clone https://github.com/peacepiece7/imgym.git /opt/imgym
cd /opt/imgym
```

`/opt/imgym/.env`에 개인 API 키를 넣고 파일 권한을 제한합니다.

```dotenv
OHMYIMG_API_KEY=32자-이상의-개인-키
```

```sh
chmod 600 /opt/imgym/.env
```

`deploy/nginx-imgym.locations.conf`를 `/etc/nginx/snippets/imgym.conf`로 복사하고, 기존 `dev.margins.cloud` HTTPS `server` 블록 안에 다음 한 줄을 추가합니다.

```nginx
include /etc/nginx/snippets/imgym.conf;
```

설정을 반영합니다.

```sh
sudo nginx -t
sudo systemctl reload nginx
```

## 배포

평소에는 **아무것도 하지 않습니다.** `main`에 푸시하면 서버가 1분 안에 알아서
가져가 다시 빌드합니다. 아래 `자동 배포`를 참고하세요.

수동으로 즉시 배포해야 할 때만 다음을 실행합니다.

```sh
cd /opt/imgym
git pull --ff-only
docker compose up -d --build
``` 배포가 끝나면 <https://dev.margins.cloud/imgym>을 열고 `/opt/imgym/.env`의 API 키를 입력합니다.

페이지는 외부에 공개되지만 모든 변환 요청에는 API 키가 필요합니다. 입력한 키는 브라우저의 `localStorage.ohmyimgapikey`에 저장됩니다.

## 자동 배포

`main`에 푸시하면 끝입니다. GitHub Actions를 쓰지 않습니다 — 서버가 Tailnet
안에만 있어서 GitHub 러너가 직접 닿지 못하고, 이 저장소는 공개라 self-hosted
러너를 두면 누구나 PR로 이 장비에서 코드를 실행할 수 있기 때문입니다. 같은
장비에서 `/opt/margins-dev`도 돌고 있어 그 위험은 받아들일 수 없습니다.

그래서 **서버가 GitHub을 당겨오는** 방식입니다. 인바운드 접근도, GitHub
시크릿도 필요 없습니다.

### 동작

1분마다 `peacepiece` 사용자 cron이 `~/.local/bin/imgym-auto-deploy`를 실행합니다.

```
origin/main 가져오기 → HEAD와 같으면 즉시 종료(대부분의 실행)
                     → 다르면 현재 이미지를 imgym:rollback 으로 태그
                     → pull, docker compose up -d --build
                     → /imgym/api/health 최대 90초 대기
                     → 실패하면 이전 커밋과 이전 이미지로 롤백
```

푸시부터 반영까지 대략 **1분(폴링) + 1~3분(빌드)** 입니다.

### 확인

```sh
tail -f ~/.local/state/imgym/deploy.log     # 배포 기록
crontab -l                                   # 등록된 항목
systemctl status cron                        # cron 자체가 살아 있는지
```

로그 한 줄이 곧 결과입니다. `OK`는 성공, `ROLLBACK`은 되돌렸다는 뜻이고,
`ROLLBACK FAILED`만 사람 손이 필요합니다.

### 잠시 멈추기

```sh
crontab -l | sed 's|^\* \* \* \* \* |#&|' | crontab -   # 주석 처리
crontab -e                                                  # 되살릴 때
```

### 다시 설치할 때

```sh
install -d ~/.local/bin ~/.local/state/imgym
cp /opt/imgym/deploy/auto-deploy.sh ~/.local/bin/imgym-auto-deploy
chmod +x ~/.local/bin/imgym-auto-deploy
( crontab -l 2>/dev/null | grep -v imgym-auto-deploy
  echo '* * * * * flock -n /tmp/imgym-deploy.lock $HOME/.local/bin/imgym-auto-deploy' ) | crontab -
```

`flock`이 배포가 겹치는 것을 막습니다. 빌드가 1분을 넘겨도 다음 cron은 그냥
건너뜁니다.

### 알아둘 점

- **cron은 저장소가 아니라 `~/.local/bin`의 복사본을 실행합니다.** 롤백이
  `git reset --hard`를 하는데, 실행 중인 스크립트 파일이 바뀌면 `/bin/sh`가
  남은 줄을 잘못 읽습니다. 복사본은 배포가 성공한 뒤 갱신되므로, 스크립트를
  고치면 **그다음 실행부터** 적용됩니다.
- **실패해도 알림이 없습니다.** GitHub Actions UI가 없으니 로그가 유일한
  기록입니다. 알림이 필요해지면 GitHub Actions + `tailscale/github-action`
  방식으로 바꿔야 하며, 그때는 시크릿 3개와 Tailscale ACL 태그가 필요합니다.
- **`nginx` 설정은 자동 배포에 포함되지 않습니다.** `deploy/`의 nginx 스니펫을
  바꿨다면 root 권한으로 따로 반영해야 합니다.
