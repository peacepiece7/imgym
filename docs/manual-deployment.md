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

```sh
cd /opt/imgym
git pull --ff-only
docker compose up -d --build
```

이후 업데이트도 같은 명령으로 배포합니다. 배포가 끝나면 <https://dev.margins.cloud/imgym>을 열고 `/opt/imgym/.env`의 API 키를 입력합니다.

페이지는 외부에 공개되지만 모든 변환 요청에는 API 키가 필요합니다. 입력한 키는 브라우저의 `localStorage.ohmyimgapikey`에 저장됩니다.
