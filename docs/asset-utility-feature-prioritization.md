# Oh My Img! 에셋 유틸리티 기능 조사와 우선순위

- 문서 상태: 기획안 v2 — P0 재검토와 제한형 P1/P2 R1 구현 완료
- 조사 기준일: 2026-09-02
- 대상: 웹 개발자, 프론트엔드 개발자, 프로덕트·브랜드 디자이너
- 범위: 이미지에 한정하지 않고 웹에 전달되는 SVG, 아이콘, 소셜 카드, 짧은 영상, 폰트, PDF 등 에셋 전반

> 2026-09-06 후속 기록: P0 재검토에서 AVIF color-box 오탐과 ICC 입력의 불완전한 sRGB 변환을 발견해 수정했다. P1 전 항목과 P2의 검증 가능한 최소 범위를 하나의 `에셋 레시피 R1`로 구현했다. 세부 범위, 의도적 상한, 로컬 177개·canonical Docker 178개 테스트, 실파일 증거는 [P0/P1/P2 구현 검토](./p0-p1-p2-implementation-review-2026-09-06.md)에 기록했다.

## 1. 결론

Oh My Img!의 다음 포지션은 **범용 이미지 편집기**나 **클라우드 DAM**보다 **디자인 산출물을 배포 가능한 파일·메타데이터·코드로 바꾸는 프라이빗 웹 에셋 핸드오프 도구**가 적합하다.

가장 먼저 하나의 `웹 에셋 팩` 흐름으로 아래 네 기능을 묶는 것을 권한다.

1. **웹 준비도 검사·핸드오프 리포트 — 96점**
2. **JPEG/PNG/WebP/AVIF 교차 변환과 품질 게이트 — 91점**
3. **반응형 이미지 파생본과 `<picture>`/`srcset` 산출 — 91점**
4. **배치 ZIP, 안전한 파일명, `manifest.json` — 87점**

이 조합은 현재 래스터 검사·리사이즈·후보 탐색·SSIM/MAE 품질 측정·순차 배치 처리 코드를 가장 많이 재사용한다. 동시에 디자이너의 “여러 크기와 이름으로 내보내기”, 프론트엔드의 “올바른 마크업 작성”, 웹 개발자의 “용량 예산과 반복 가능한 빌드”를 한 번에 잇는다.

새 기능보다 먼저 지켜야 할 게이트도 있다. 기존 로드맵에 기록된 대표 코퍼스 보정과 실제 브라우저 검증 없이 교차 포맷 품질 기준을 확장해서는 안 된다. 이 선행 조건은 2026-09-05 완료했으며, 이후 포맷·콘텐츠 범위 확장은 같은 게이트를 반복 적용한다.

## 2. 현재 제품과 조사 범위

현재 구현은 다음을 제공한다.

- PNG/JPEG/WebP 정적 이미지의 크롭, 축소, **동일 포맷** 최적화
- 파일별 부분 성공을 허용하는 최대 10개 순차 배치 처리
- 래스터 PNG/JPEG/WebP를 SVG로 벡터화하고 SVGO로 최적화
- 품질 자동 모드의 SSIM, MAE, 경계·알파 오차 검사
- Markdown을 PDF/UA 문서로 변환
- 단일 소유자 API 키, 요청별 임시 처리, 영구 저장 없음

세부 내용은 [프로젝트 README](../README.md), [래스터 설계](./raster-crop-and-optimization-design.md), [배치 설계](./multi-image-upload-design.md), [벡터 설계](./image-optimization-design.md)를 기준으로 삼았다.

조사 시점의 핵심 공백과 구현 이후 상태는 다음과 같다.

- 완료(P0/P1) — PNG/JPEG/WebP 교차 출력과 AVIF 파생본, SDR HEIC 입력 변환
- 완료(P0) — 배치·선택 결과의 스트리밍 ZIP과 기계가 읽는 manifest
- 완료(P0) — 반응형 파생본, `srcset`/`sizes`, HTML·Next.js 핸드오프
- 완료(P0) — 업로드 직후 파일 메타데이터와 웹 준비 상태 설명
- 완료(P1) — 이미 존재하는 SVG를 직접 안전하게 정리하는 흐름
- 완료(제한형 P1/P2 R1) — favicon/PWA·네이티브 아이콘, OG 카드, 폰트 서브셋, 짧은 무음 모션 같은 인접 에셋 흐름

## 3. 조사 방법과 한계

이번 결과는 다음 세 종류의 데스크 리서치를 결합했다.

1. **실제 웹 관측치**: HTTP Archive Web Almanac의 페이지 용량, 포맷, 반응형 마크업, 접근성 데이터
2. **표준·플랫폼 요구**: MDN, W3C/WCAG, Open Graph, Google Search, Apple, Android, Next.js 16 문서
3. **도구 수렴 신호**: Figma, Cloudinary, Squoosh, Sharp, ImageMagick, SVGO가 공식적으로 제공하는 작업

이 문서는 사용자 인터뷰나 Oh My Img!의 제품 분석 데이터를 대체하지 않는다. 특히 배경 제거, OCR, 생성형 편집의 “인기”는 공급자 기능 수렴으로만 확인했으며 실제 사용 빈도는 확인하지 못했다. 그래서 총점과 별도로 근거 신뢰도를 표시했다.

- **A**: 대규모 관측 데이터 또는 규범적 표준과 공식 구현 문서가 함께 있음
- **B**: 복수의 공식 생태계·도구 문서가 같은 작업을 지원함
- **C**: 공급자 기능 또는 제품 가설 중심이며 사용 빈도 근거가 약함

## 4. 핵심 증거

### 4.1 이미지 최적화는 여전히 큰 문제다

- 2025년 중앙값 페이지는 이미지에 데스크톱 **1,059KB**, 모바일 **911KB**를 사용했다. 중앙값 요청 수도 데스크톱 14개, 모바일 12개다. 이미지 바이트는 해상도·인코딩·압축의 영향을 받고 지연과 LCP에 직접 연결된다. [E1]
- 2024년 모바일 이미지 포맷 비중은 JPEG 32.4%, PNG 28.4%, GIF 16.8%, WebP 12.0%, SVG 6.4%, AVIF 1.0%였다. 2년간 상대 증가는 WebP 34%, SVG 36%, AVIF 386%였다. 레거시 포맷과 현대 포맷을 함께 다루는 교차 변환이 필요하다는 신호다. [E2]
- MDN은 WebP와 AVIF가 JPEG/PNG보다 압축 효율이 높고 투명도를 지원한다고 설명한다. AVIF에는 역사적 호환성을 위한 fallback을 함께 제공할 것을 권한다. [E4]

### 4.2 파일만 줄여서는 배포 문제가 끝나지 않는다

- 모바일 페이지의 42%가 `srcset`을 사용하지만, `sizes`의 중앙값 오차는 모바일 16%, 데스크톱 43%였다. `<picture>` 사용 페이지는 9.3%에 그쳤다. [E2]
- `<img>`에 `width`와 `height`가 모두 있는 비율은 32%뿐이며, 이는 레이아웃 이동 방지와 직결된다. LCP를 담당하는 이미지의 9.5%는 오히려 지연 로딩되어 있었다. [E2]
- MDN은 반응형 이미지의 두 문제를 해상도 전환과 아트 디렉션으로 구분하고, 각각 `srcset`/`sizes`와 `<picture>`를 해법으로 제시한다. [E3]
- Next.js 16의 `<Image>`도 올바른 크기, 현대 포맷, CLS 방지, 지연 로딩, blur placeholder를 제공한다. 단, 원격·동적 이미지는 개발자가 `width`, `height`, 선택적인 `blurDataURL`을 직접 제공해야 한다. [E6]

따라서 제품은 무조건 같은 파생본을 만드는 대신 배포 대상을 구분해야 한다.

- **정적 HTML/CMS 프로필**: 실제 파생 파일, fallback, `<picture>`/`srcset` 코드 생성
- **Next.js 프로필**: 정적 import가 이미 해 주는 일을 중복하지 않고, 원격·동적 이미지에 필요한 치수·`sizes`·placeholder를 제공
- **디자인 핸드오프 프로필**: 배율, 고정 폭·높이, suffix, 폴더·파일명 중심

### 4.3 디자이너의 내보내기와 개발자의 소비 사이에 반복 작업이 있다

- Figma는 PNG/JPG/SVG/PDF, 배율 또는 고정 폭·높이, suffix, 품질, 리샘플링, sRGB/Display P3를 지원한다. 한 선택에 여러 내보내기 설정을 붙이고 페이지의 설정된 에셋을 일괄 내보낼 수도 있다. 슬래시 이름은 중첩 폴더로 변환된다. [E7, E8]
- Figma Dev Mode는 개발자가 아이콘과 원본 이미지, GIF·MP4를 내려받는 별도 에셋 흐름을 제공한다. 디자인 도구 밖에서 최종 웹 변환이 계속 필요하다는 신호다. [E7]
- Cloudinary는 서버 리사이즈·크롭, format/quality 자동화, `srcset`, 아트 디렉션, 파일 크기 차이를 이용한 반응형 breakpoint 계산을 한 흐름으로 제공한다. [E9]

### 4.4 접근성·색상·메타데이터도 에셋 산출물의 일부다

- 2024년 `<img>` 중 비어 있지 않은 `alt`가 있는 비율은 55%뿐이었다. 다만 W3C는 같은 이미지라도 정보성·장식·기능·복합 이미지인지와 사용 문맥에 따라 대체 텍스트가 달라진다고 명시한다. 이미지 단독 AI 설명을 최종 `alt`로 자동 확정하면 안 된다. [E2, E5]
- WCAG AA의 최소 대비는 일반 텍스트 4.5:1, 큰 텍스트와 UI 그래픽 3:1이다. 이미지에서 추출한 팔레트는 대비 검사와 함께 제공할 때 실무 산출물이 된다. [E12]
- Figma는 sRGB와 Display P3를 구분해 할당·변환·내보내며, 현재 제품도 ICC 보존 정책을 이미 갖고 있다. 메타데이터 제거는 GPS/EXIF/XMP와 ICC/CICP 색상 정보를 구분해야 한다. [E8, E10]

### 4.5 이미지 밖의 에셋은 가치가 있지만 같은 우선순위는 아니다

- Open Graph의 기본 필수 속성에 `og:image`가 포함되고, Next.js는 favicon, Apple icon, OG/Twitter image를 파일 규약으로 지원한다. Google Search는 정사각 favicon을 요구하고 48×48 이상을 권한다. [E11]
- 2025년 웹 폰트의 중앙값 파일은 30KB대 중후반, 90백분위는 약 115KB였다. WOFF2가 약 65%를 차지하며 큰 CJK·아이콘 폰트에는 서브셋이 특히 중요하다. [E14]
- 2024년 GIF의 32%가 애니메이션이었다. web.dev의 한 사례에서는 3.7MB GIF가 551KB MP4 또는 341KB WebM으로 줄었다. 보편적 절감률은 아니지만 GIF 전용 경로의 잠재 효과를 보여 준다. [E2, E13]
- Apple 기기는 HEIF/HEVC를 저장 효율이 높은 캡처 포맷으로 사용하고 필요할 때 JPEG/H.264로 변환한다. HEIC는 웹 출력 포맷보다 **입력 호환성** 기능으로 보는 편이 맞다. [E15]

## 5. 세 직군의 반복 작업

| 작업 단계 | 웹 개발자 | 프론트엔드 개발자 | 디자이너 | 공통 산출물 |
|---|---|---|---|---|
| 입력 확인 | MIME, 픽셀 수, 메타데이터, 용량 예산 | 렌더링 치수, 알파, 애니메이션 | 색상 프로필, 원본 품질 | 검사 리포트 |
| 변환 | 자동화 가능한 포맷·프리셋 | WebP/AVIF와 fallback | PNG/JPG/SVG, 1x/2x/3x | 결정 가능한 레시피 |
| 반응형 처리 | 빌드·CMS용 파생본 | `srcset`, `sizes`, `<picture>` | 모바일/데스크톱 아트 디렉션 | 파일 + 코드 |
| 프레이밍 | 규격 검증 | `object-fit`과 실제 크롭 일치 | 비율 크롭, 패딩, 투명 여백 제거 | 일관된 변형 세트 |
| 접근성·브랜드 | 정책·감사 | `alt`, 치수, loading 우선순위 | 팔레트, 대비, 아이콘 가독성 | manifest + 체크리스트 |
| 전달 | CLI/CI, 해시, 실패 코드 | 복사 가능한 JSX/HTML | 이름·suffix·폴더 구조 | ZIP + manifest |
| 검수 | 재현성과 예산 통과 | CLS/LCP·렌더링 확인 | 전후 비교와 색상 확인 | 미리보기 + 품질 근거 |

세 역할의 교집합은 “더 많은 편집 필터”가 아니라 **검사 → 규격별 변환 → 검수 → 묶음 전달**이다.

## 6. 점수 모델

각 항목을 0~5점으로 평가하고 다음 식으로 100점 만점으로 환산했다.

```text
총점 = 수요 근거 D×6 + 직군 범위 R×4 + 결과 영향 I×4 + 제품 적합 F×3 + 구현 용이 E×3
       └ 30점       └ 20점       └ 20점       └ 15점       └ 15점
```

- **D 수요 근거**: 관측 데이터, 표준 요구, 복수 도구 수렴의 강도
- **R 직군 범위**: 웹 개발·프론트엔드·디자인 중 실제로 이득을 보는 범위
- **I 결과 영향**: 바이트·시간·오류·접근성·핸드오프 비용 감소
- **F 제품 적합**: 현재 무저장·자가 호스팅 모델과 기존 파이프라인 재사용성
- **E 구현 용이**: 점수가 높을수록 새 런타임·모델·보안 경계가 적다

우선순위 구간은 다음과 같다.

- **P0, 85~100**: 다음 제품 묶음에 포함
- **P1, 75~84**: P0 기반 위에서 순차 구현
- **P2, 60~74**: 코퍼스·사용자 과제로 먼저 검증하거나 통합을 우선 검토
- **P3, 0~59**: 현재는 만들지 않음

점수는 시장 규모 예측치가 아니라 같은 기준으로 상대 순서를 정하는 의사결정 도구다. `D/R/I/F/E` 열은 각 하위 점수를 같은 순서로 표시한다.

## 7. 전체 기능 우선순위

| 순위 | 기능 | D/R/I/F/E | 총점 | 우선순위 | 근거 | 신뢰 |
|---:|---|:---:|---:|:---:|---|:---:|
| 1 | 웹 준비도 검사·핸드오프 리포트 | 5/5/4/5/5 | **96** | P0 | E1, E2, E5, E6, E8, E10 | A |
| 2 | JPEG/PNG/WebP/AVIF 교차 변환 | 5/5/5/4/3 | **91** | P0 | E1, E2, E4, E10 | A |
| 3 | 반응형 이미지 팩과 코드 산출 | 5/5/5/4/3 | **91** | P0 | E1, E2, E3, E6, E9 | A |
| 4 | 배치 ZIP·안전한 이름·manifest | 4/5/4/5/4 | **87** | P0 | E7, 기존 배치 설계 | B |
| 5 | 직접 SVG 최적화·안전 검사 | 4/5/4/5/3 | **84** | P1 | E2, E7, E17 | B |
| 6 | favicon·PWA·Apple touch 웹 아이콘 팩 | 4/5/4/4/4 | **84** | P1 | E11, E19 | A |
| 7 | 회전·반전·투명 trim·pad·비율 프리셋 | 4/5/3/5/4 | **83** | P1 | E7, E9, E10 | B |
| 8 | 전후 슬라이더·오버레이·품질 설명 | 3/5/4/5/4 | **81** | P1 | E10, 기존 품질 측정 코드 | B |
| 9 | 수동 초점 기반 멀티 비율 크롭 | 4/5/4/4/3 | **81** | P1 | E3, E9 | B |
| 10 | 팔레트·WCAG 대비·CSS 변수 | 4/5/3/4/4 | **80** | P1 | E8, E12 | A |
| 11 | HEIC/HEIF 입력 후 웹 포맷 변환 | 4/5/4/3/3 | **78** | P1 | E4, E10, E15 | A |
| 12 | OG·소셜 카드 킷 | 4/5/4/3/3 | **78** | P1 | E11 | A |
| 13 | CLI·CI 에셋 감사와 예산 실패 | 4/3/5/4/3 | **77** | P1 | E1, E10, E16, E17 | B |
| 14 | GIF→MP4/WebM과 poster 추출 | 4/4/5/2/2 | **72** | P2 | E2, E13 | A |
| 15 | WOFF2 변환·문자 서브셋 | 4/4/4/2/3 | **71** | P2 | E14 | A |
| 16 | LQIP·BlurHash·주조색 placeholder | 3/4/3/4/4 | **70** | P2 | E6, E20 | B |
| 17 | 워터마크·텍스트/이미지 합성 | 3/4/3/4/4 | **70** | P2 | E9, E10 | B |
| 18 | 클라우드 DAM·CDN·협업 기능 | 4/5/4/1/1 | **66** | P2 | E2, E9 | B |
| 19 | AI 배경 제거·교체 | 4/4/4/2/1 | **65** | P2 | E18 | B |
| 20 | iOS·Android 네이티브 아이콘 카탈로그 | 3/4/3/3/2 | **61** | P2 | E19 | A |
| 21 | 에셋 인벤토리·해시·중복 탐지 | 3/3/3/3/3 | **60** | P2 | E7, E10 | C |
| 22 | 스프라이트·콘택트시트·QR 생성 | 2/3/2/4/4 | **56** | P3 | E10 | C |
| 23 | 일반 영상 트랜스코드·편집 | 3/4/4/1/1 | **56** | P3 | E1, E13 | B |
| 24 | PDF 병합·분할·이미지 추출·압축 | 2/3/3/3/2 | **51** | P3 | 인접 도구 가설 | C |
| 25 | OCR·얼굴/민감정보 자동 가림 | 3/3/3/1/2 | **51** | P3 | 인접 도구 가설 | C |
| 26 | AI 업스케일·생성형 채우기 | 3/3/3/1/1 | **48** | P3 | E18, 인접 도구 가설 | C |

## 8. 권장 제품 묶음

### 8.1 P0 — `웹 에셋 팩 R1`

P0 네 항목을 서로 다른 탭으로 흩뜨리지 말고 하나의 완결된 작업으로 제공한다.

```text
업로드
  → preflight 검사
  → 포맷·크기 후보 생성
  → SSIM/MAE/경계/알파 품질 게이트
  → 이득 없는 파생본 제거
  → 대상별 코드와 manifest 생성
  → 미리보기·개별 다운로드·ZIP
```

#### 입력과 검사

R1 입력은 현재 안전 경계와 동일한 정적 PNG/JPEG/WebP로 시작한다. 업로드 직후 아래를 디코딩 전후로 구분해 보여 준다.

- 실제 MIME과 확장자 일치 여부
- 바이트, 폭·높이, 총 픽셀, 종횡비
- 알파 유무, 프레임 수·애니메이션 여부
- EXIF orientation, ICC/CICP 색상 정보, EXIF/IPTC/XMP/GPS 존재 여부
- 이미지 유형 힌트: 사진, 스크린샷·UI, 로고·평면 그래픽, 투명 에셋
- 원본 bits-per-pixel과 예상 용도별 경고

민감 메타데이터의 **존재**는 보여 주되 manifest와 서버 로그에는 원래 GPS 값·카메라 식별값을 복사하지 않는다.

#### 출력 프로필

1. **정적 HTML/CMS**
   - 품질 기준을 통과한 fallback JPEG/PNG, WebP, AVIF
   - 기본은 레이아웃 프리셋에서 폭 후보를 만들고 파일 크기 차이가 작은 파생본을 자동 제거
   - 고급 설정에서는 사용자가 출력 폭을 직접 지정
   - `<picture>`, `srcset`, `sizes`, `width`, `height`가 포함된 코드
2. **Next.js 16**
   - 정적 import라면 Next가 자동 생성하는 파생본·치수·blur를 중복 생성하지 않는 안내
   - 원격·동적 이미지라면 치수, `sizes`, 작은 `blurDataURL` 선택지를 포함한 JSX
   - `priority`가 아니라 현재 API의 `preload`/`fetchPriority`·`loading` 선택을 문맥 질문으로 결정
3. **디자인 핸드오프**
   - 1x/2x/3x 또는 고정 `w`/`h`, suffix, 폴더 규칙
   - sRGB/Display P3 정책과 리샘플링 방식 표시

#### 반응형 폭 선택

- 일반 사용자는 대상 레이아웃 프리셋을 고른다. 서버는 프리셋에 맞는 폭 후보를 만들고 byte-delta가 작아 실익이 없는 중간 파생본을 자동 pruning한다.
- 고급 사용자는 출력 폭 목록을 직접 지정할 수 있다. 직접 지정한 값은 중복, 원본 초과 확대, 안전 상한 위반만 정규화하고 자동 pruning으로 임의 제거하지 않는다.
- 최종 폭 목록과 각 후보의 포함·제외 이유를 결과 화면과 manifest에 남긴다.

#### 포맷 선택 원칙

- 원본보다 작고 품질 게이트를 통과할 때만 현대 포맷을 포함한다.
- 사진에는 손실 후보, 스크린샷·텍스트·작은 아이콘에는 무손실/알파 보존 후보를 우선한다.
- 확대하지 않는다.
- AVIF가 항상 최선이라고 가정하지 않는다. 인코딩 시간과 progressive 표시 부재도 결과 설명에 포함한다.
- fallback 하나는 반드시 남긴다.
- 포맷별 하나의 보편 임계값을 쓰지 않고 사진·로고·스크린샷·투명 이미지 코퍼스로 별도 보정한다.
- `프로필 보존`에서는 ICC와 CICP를 서로 대체 가능한 신호로 보지 않고 각각 보존·검증한다.
- 원본 CICP와 동등한 신호를 증명할 수 없는 현대 포맷 후보는 `color-profile` 사유로 제외한다. 사용자가 `Web safe`를 명시한 경우에만 sRGB 변환 후 현대 포맷 후보를 평가한다.

#### 접근성 핸드오프

`alt` 자동 완성보다 다음 결정 흐름을 제공한다.

1. 장식 이미지인가?
2. 링크·버튼 같은 기능 이미지인가?
3. 본문 정보를 전달하는가?
4. 차트·다이어그램처럼 긴 설명이 필요한가?

사용자가 문맥을 입력한 뒤 코드에 반영한다. 장식은 `alt=""`, 기능 이미지는 외형이 아니라 동작, 정보 이미지는 핵심 의미를 설명한다. AI 캡션을 나중에 추가하더라도 초안으로 표시하고 사람이 확정하게 한다.

#### ZIP과 manifest

파일 하나의 반응형 팩과 배치 성공 결과 전체를 각각 내려받을 수 있어야 한다. 두 경우 모두 제한된 서버 스트리밍 ZIP으로 통일하고, 브라우저가 전체 ZIP을 메모리에 조립하는 경로는 기본으로 두지 않는다. ZIP 엔트리는 경로 순회를 막고, 전체 비압축 크기와 엔트리 수를 제한한다. 연결이 끊기거나 요청이 취소되면 스트림과 임시 파일을 정리한다.

`manifest.json`에는 다음을 넣는다.

- 버전이 있는 레시피 ID
- 입력·출력 SHA-256, MIME, 폭·높이, 바이트
- 선택된 후보와 품질 측정값
- 제거·보존된 메타데이터 종류
- 생성 파일명과 용도·폭·포맷
- 생성된 HTML/JSX 또는 별도 snippet 파일 경로
- 파일별 성공·실패와 짧은 안전 오류

시간, 절대 임시 경로, 원래 GPS 값처럼 재현성과 프라이버시를 해치는 값은 제외한다.

#### 완료 조건

- 같은 입력과 같은 레시피는 같은 파일 목록·이름·manifest 의미를 만든다.
- 품질 게이트를 실패한 후보는 다운로드 팩에 들어가지 않는다.
- 확대·잘못된 EXIF 방향·알파 손실·의도하지 않은 프로필 제거가 없다.
- 10개 배치에서 한 파일 실패가 다른 성공 결과를 막지 않는다.
- 취소 시 새 후보가 시작되지 않고 자식 프로세스와 임시 파일이 정리된다.
- HTML은 유효한 fallback을 가지며, Next.js 16 예시는 현재 API와 일치한다.
- ZIP과 전체 산출물은 별도의 총량 상한을 가진다.
- 단일·배치 ZIP은 전체 archive를 서버나 브라우저 메모리에 올리지 않고 스트리밍된다.

#### 2026-09-05 소유자 코퍼스 릴리스 검수

소유자가 제공한 175개 파일 중 원본 위치에서 PNG 72개와 SVG 4개의 구성을 확인했다. 비미디어 파일, 자격 증명, 사적 문서는 열거나 업로드하지 않았고, 원본을 프로젝트에 복사하지 않았다. 중복을 피하면서 사진형 이미지, 로고, 투명 에셋, 일러스트, UI 스크린샷, 긴 텍스트 이미지, Display P3를 포괄하는 PNG 8개(합계 약 9.9MB)를 선정했다.

| 대표 에셋 | 입력 특성 | 검수 초점 | 최종 판정 |
|---|---|---|---|
| 안경 소년 아바타 | 1074×948, 알파, Display P3 | 투명 경계·ICC/CICP | 통과 |
| 책 읽는 소녀 실루엣 | 976×1116, 알파, Display P3 | 단색 로고 경계·Chrome 미리보기 | 통과 |
| 프론트엔드 채용 공고 | 1000×4963, sRGB | 긴 텍스트 가독성·축소본 | 통과 |
| 책 기록 라이브러리 화면 | 2740×1872, Display P3 | UI 텍스트·선·반응형 폭 | 통과 |
| 손 클로즈업 hero | 1094×434, 알파, Display P3 | wide hero·장식용 `alt=""` | 통과 |
| 도트 패턴 로고 | 490×500, 알파, Display P3 | 1x/2x/3x·확대 금지 | 통과 |
| 책 표지 일러스트 | 1024×1536, 알파 | PNG/WebP/AVIF·알파 품질 | 통과 |
| 헤드셋 소녀 아바타 | 1254×1254, 불투명 | 사진형 손실 압축·fallback | 통과 |

최종 코드의 성공 산출물을 합산하면 8개 입력에서 42개 출력, 28,105,032바이트가 생성됐다. PNG 21개, WebP 9개, AVIF 9개, JPEG 3개가 품질 게이트를 통과했고, 품질 실패·확대·EXIF/IPTC/XMP/GPS 누출·ICC/CICP 신호 손실은 모두 0건이었다. 원본보다 큰 폭 23개는 `no-upscale`, 보존을 증명할 수 없는 파생 포맷 30개는 `color-profile`로 제외됐다. 세 ZIP 모두 무결성 검사를 통과했다.

사람 검수에서는 긴 텍스트, UI 선, 로고 경계, 투명 가장자리의 눈에 띄는 열화를 찾지 못했다. 대표 Display P3 PNG는 976×1116 출력에서 SSIM 1.0000, MAE·경계·알파 오차 0이었고 Chrome 미리보기와 접근성 문구도 정상 동작했다. 투명 일러스트의 최대 AVIF는 PNG fallback의 약 14% 크기에서 SSIM 0.9966이었고, 불투명 아바타의 JPEG는 원본의 약 24%였다.

이 검수에서 두 결함을 실제로 발견해 수정했다. 첫째, PNG 텍스트 메타데이터 제거 옵션이 ICC를 함께 잃게 하던 경로를 바이너리 청크 필터로 분리했다. 둘째, ICC만 남고 CICP가 사라져 Display P3가 다른 프로필로 해석되던 경로를 막고 두 신호를 독립적으로 검증했다. 생성 시각 `tIME`도 제거해 같은 입력·레시피의 해시 결정성을 회복했다. 원본과 출력의 대표 ICC SHA-256 및 CICP 원시 값이 각각 일치함을 확인했다.

검수 환경이 장시간 백그라운드 프로세스를 중단시키면서 일부 연속 배치의 ImageMagick 제한 시간이 왜곡됐다. 따라서 위 합계는 최종 코드로 성공한 배치 산출물과 중단된 2개 입력의 격리 재실행을 합친 릴리스 정확성 결과이며, 중단된 실행 시간은 성능 기준선에 쓰지 않는다. 중단 없는 환경의 포맷·유형별 p50/p95와 peak RSS 측정은 운영 계측 과제로 남긴다.

### 8.2 P1 — 핸드오프 범위를 넓히는 기능 (R1 구현 완료)

P1은 점수만이 아니라 P0 의존 순서로 구현한다.

1. **직접 SVG 최적화·안전 검사**
   - Figma·Illustrator 등에서 나온 SVG를 래스터화하지 않고 정리
   - `viewBox`, ID 참조, gradient, clipPath, 접근성 title/desc 보존 여부를 전후 비교
   - SVGO는 최적화기이지 완전한 sanitizer가 아니므로 업로드 SVG를 inline DOM에 넣지 않음
2. **프레이밍 기본기와 수동 초점**
   - 90° 회전, 반전, 투명 여백 trim, pad/배경, 1:1·4:3·3:2·16:9·2:1 프리셋
   - 하나의 초점을 두고 모바일 portrait, 카드 square, 데스크톱 hero를 사람이 검수
   - AI smart crop은 수동 초점의 대체가 아니라 후속 제안 기능
3. **웹 아이콘 팩**
   - favicon.ico, PNG/SVG icon, Apple touch icon, PWA maskable/monochrome
   - 원형·squircle·둥근 사각형과 작은 크기 가독성 미리보기
   - `manifest.webmanifest` 조각과 Next.js 파일명 규약 제공
4. **시각 비교와 색상 도구**
   - 전후 슬라이더, 깜박임·오버레이, 기존 수치의 쉬운 설명
   - 주조색·팔레트, HEX/RGB/OKLCH, CSS 변수, WCAG AA/AAA 대비 조합
5. **OG·소셜 카드**
   - 고정 템플릿, 안전 영역, 제목 길이 검증, `og:image:alt`
   - 범용 PNG/JPEG와 Next.js `opengraph-image`·`twitter-image` 이름 제공
6. **CLI·CI 감사**
   - manifest 레시피 재실행, 디렉터리 구조 보존, 변경된 파일만 처리
   - 픽셀·바이트 예산, 금지 포맷, 민감 메타데이터, 누락 치수를 비대화형 실패 코드로 제공
7. **HEIC/HEIF 입력**
   - JPEG/PNG/WebP/AVIF로 내보내는 입력 호환성만 우선
   - canonical Alpine 컨테이너에 디코더를 명시적으로 설치하고 orientation, HDR/gain map, 색공간, 시간·메모리 상한을 별도 검증

### 8.3 P2 — 제한형 R1 구현 완료, 확장형은 별도 검증

- **GIF→영상**: 무음 반복 GIF 전용 WebM/MP4/poster를 최대 30초·30fps로 구현했다. 일반 영상 편집은 계속 제외한다.
- **폰트**: 권리 확인을 필수로 하는 WOFF2 문자 서브셋과 CSS를 구현했다. 글리프 누락, shaping, variable axes, 실제 라이선스 판정은 사람 검수로 남긴다.
- **LQIP/BlurHash**: 기존 작은 WebP 경로를 프레임·팔레트·소셜 레시피에 재사용했다. BlurHash 의존성과 Next.js 정적 import 중복은 추가하지 않았다.
- **배경 제거**: 단색 유사도 제거와 투명 trim을 구현했다. 범용 AI 모델은 모델 크기, CPU/RAM, 머리카락·반투명 경계 품질, 라이선스를 비교하는 격리 POC로 남긴다.
- **DAM/CDN**: 이식 가능한 버전 manifest까지만 구현했다. 저장·권한·공유·삭제·변형 URL·과금은 무저장 단일 소유자 제품의 경계를 바꾸므로 추가하지 않았다.
- **네이티브 앱 아이콘**: 웹 아이콘 레시피의 opt-in으로 iOS 1024 source와 Android density/adaptive/monochrome 출력을 구현했다. 플랫폼 규격은 버전 레시피로 관리한다.
- **인벤토리·중복 탐지**: CLI/CI 감사에 SHA-256 완전 중복과 실패 코드를 구현했다. perceptual duplicate는 별도 임계값과 오탐 UI가 필요하므로 제외했다.

### 8.4 P3 — 현재 만들지 않을 것

- 일반 영상 편집기, 타임라인, 오디오 편집
- 범용 PDF 툴킷; 현재의 의미 있는 Markdown→PDF 흐름은 유지
- OCR, 얼굴·번호판 자동 가림
- AI 업스케일, 생성형 채우기, 텍스트→이미지
- 스프라이트·QR 등 좁은 단발성 생성기를 상위 내비게이션에 추가

이 기능들은 나쁜 기능이 아니라 현재 제품의 재사용성·보안 경계·검증 능력 대비 우선순위가 낮다.

## 9. 권장 개발 순서

### Gate 0 — 기존 품질 근거 완성

- 완료(2026-09-05) — 소유자 코퍼스에 사진형 이미지, 로고, 투명 에셋, 일러스트, UI 스크린샷, 긴 텍스트, Display P3 샘플을 선정하고 사람 검수 결과 보존
- 완료(2026-09-05) — 실제 Chrome의 세 P0 프로필, 크롭, 배치, 미리보기, 디스크 스트림·메모리 fallback 다운로드, 390px 화면 회귀 확인
- 완료(2026-09-05) — ICC/CICP 독립 보존, privacy 청크 제거, 출력 결정성 회귀 테스트 추가

### Increment 1 — Asset Inspect R1

- 공통 `AssetFacts` 모델과 manifest schema
- MIME·치수·알파·애니메이션·색공간·민감 메타데이터 요약
- 현재 개별 결과 화면에 preflight와 품질 설명 연결

### Increment 2 — Cross-format R1

- 입력 포맷과 출력 포맷을 타입·API에서 분리
- JPEG/PNG/WebP부터 교차 출력, 그다음 canonical 컨테이너의 AVIF delegate 검증
- 포맷·콘텐츠 유형별 코퍼스 보정과 dominated 후보 제거

### Increment 3 — Web Pack R1

- 정적 HTML/CMS와 Next.js 16 대상 프로필
- 프리셋·자동 pruning·고급 폭 직접 지정과 코드 생성
- per-asset 서버 스트리밍 ZIP과 manifest

### Increment 4 — Batch handoff R1

- 모든 성공 결과의 서버 스트리밍 ZIP, 안전한 중첩 이름, 부분 실패 보고
- 서버 스트림 peak memory, 연결 중단 정리, 출력 총량 검증
- 비대화형 API·CLI 계약 초안

### Increment 5 — P1 레시피

- 완료(2026-09-06) — 직접 SVG → 프레이밍/초점 → 웹 아이콘 → 비교/팔레트 → OG → CI → HEIC 구현
- 완료(2026-09-06) — P2의 GIF·폰트·LQIP·워터마크·단색 배경·portable manifest·네이티브 아이콘·정확 중복을 제한형 R1로 연결

상대 크기 추정은 `Inspect S`, `Cross-format M`, `Web Pack M/L`, `Batch bundle M`, `직접 SVG M`, `웹 아이콘 M`, `GIF·AI L/XL`이다. 달력 일정은 담당 인원과 배포 환경이 정해진 뒤 산정한다.

## 10. 제품·기술 원칙

### 레시피 우선

코덱의 모든 플래그를 노출하지 않는다. 사용자는 `사진`, `스크린샷`, `로고/아이콘`, `반응형 hero`, `소셜 카드` 같은 결과를 선택하고 서버가 버전이 있는 후보군을 소유한다.

### 설명 가능한 자동화

“Auto가 가장 작다”만 보여 주지 않고 선택 포맷, 절감 바이트, 품질 게이트, 제외된 후보 이유를 알려 준다. 자동 추천은 언제나 수동 출력 선택으로 되돌릴 수 있어야 한다.

### 원본과 색상에 보수적

- 원본을 덮어쓰지 않는다.
- 기본 privacy 정책은 EXIF/GPS/IPTC/XMP를 제거하되 ICC/CICP는 별도 취급한다.
- 색상 프로필 보존을 기본값으로 삼는다. sRGB 변환은 명시적 `Web safe` 선택일 때만 수행하며, Display P3 보존 결과와 혼동하지 않는다.
- orientation 적용 후 orientation 태그를 제거해 이중 회전을 막는다.

### 영구 저장 없음 유지

Squoosh도 로컬 처리를 명시적인 프라이버시 가치로 내세운다. Oh My Img!는 브라우저 내 처리와 같지는 않지만 자가 호스팅, 요청 격리, 영구 저장 없음이라는 경계를 유지할 수 있다. DAM 기능 때문에 이를 암묵적으로 바꾸지 않는다. [E16]

### 프레임워크 중복 방지

Next.js·이미지 CDN처럼 런타임에 올바른 파생본을 이미 만드는 대상에는 정적 파일 수를 불필요하게 늘리지 않는다. 이 제품의 가치는 대상별로 **필요한 것만** 내보내는 데 있다.

## 11. 측정 계획

### 핵심 결과 지표

- **Time to web-ready**: 업로드부터 유효한 코드 복사와 ZIP 다운로드까지 걸린 시간
- **Bytes saved at quality gate**: 사람 승인 품질을 통과한 실제 절감 바이트
- **Useful variant ratio**: 생성한 파생본 중 manifest·코드에서 실제 참조되는 비율
- **First-pass completion**: 외부 도구로 다시 열지 않고 과제를 끝낸 비율
- **Handoff correctness**: MIME, 치수, `srcset`, fallback, 파일명이 테스트를 통과한 비율

### 안전 지표

- 품질 게이트 실패 결과 배포 0건
- privacy 프리셋의 GPS/EXIF/XMP 누출 0건
- 잘못된 EXIF 방향, 알파 손실, 비의도적 색상 변환 0건
- 요청 취소 뒤 시작된 추가 후보 0건
- ZIP path traversal와 출력 상한 우회 0건
- 포맷·콘텐츠 유형별 p50/p95 처리 시간, peak RSS, 실패율

### 검증 과제

각 직군에게 기능 이름이 아니라 실제 과제를 준다.

- 웹 개발자: 20개 에셋을 예산과 규칙에 맞춰 CI에서 검증
- 프론트엔드: 한 hero를 정적 HTML과 Next.js 원격 이미지에 각각 배포
- 디자이너: 같은 원본으로 mobile/card/desktop 변형과 아이콘 팩을 전달

P1/P2 R1 이후의 기능 상한 확장은 위 과제에서 반복적인 외부 도구 전환이나 완료 실패가 관찰된 경우에만 승격한다. 제3자 분석 스크립트 대신 콘텐츠를 기록하지 않는 소유자용 집계와 과제 관찰을 우선한다.

현재 8개 릴리스 코퍼스는 Gate 0의 품질 결함 탐지에는 충분했지만 성능 보정 표본은 아니다. 다음 측정에서는 권리 확인된 최근 작업물 20~30개로 유형을 확장하고, 중단 없는 Node 24 Alpine 환경에서 p50/p95 처리 시간과 peak RSS를 기록한다.

## 12. 주요 위험과 확정 정책

| 위험 | 영향 | 권장 대응 |
|---|---|---|
| AVIF 인코딩 CPU 시간 | 배치 지연·DoS 면적 증가 | 별도 전체 탐색 deadline, 동시성 1, 후보 수 제한, corpus pruning |
| HEIC/HDR·색공간 손실 | 사진 색·밝기 변화 | 입력만 먼저 지원, SDR 변환을 명시, gain map 샘플 회귀 |
| ICC/CICP 이중 신호 손실·충돌 | wide-gamut 색이 다른 프로필로 해석 | 두 신호를 독립 검증, 동등 보존을 증명하지 못한 포맷은 `color-profile`로 제외, sRGB 변환은 명시적 선택만 허용 |
| 직접 SVG의 스크립트·외부 참조 | XSS·데이터 반출 | sanitizer 경계, inline 금지, 외부 fetch 금지, CSP·download 우선 |
| ZIP 폭탄·경로 순회 | 메모리·파일시스템 위험 | 엔트리/비압축 총량 제한, 서버 생성 이름, 경로 정규화 |
| `alt` 자동 생성의 문맥 오류 | 접근성 퇴행 | 목적 분류와 사람 확정, AI는 초안만 제공 |
| 반응형 파생본 과다 생성 | 캐시·스토리지·다운로드 낭비 | 파일 크기 차이 기반 pruning, 대상 프로필별 최소 세트 |
| 폰트 라이선스·글리프 누락 | 법적·렌더링 문제 | 권리 확인, shaping 회귀, 사용 문자열 기반 opt-in |
| DAM·AI 확장 | 제품 정체성·운영 비용 분산 | 별도 integration/POC로 격리, P0 데이터 없이는 승격 금지 |

핵심 구현 정책은 다음과 같이 확정한다.

| 항목 | 확정 정책 |
|---|---|
| 반응형 이미지 폭 | 기본은 **레이아웃 프리셋 + byte-delta 자동 pruning**이다. 고급 사용자는 폭 목록을 직접 지정할 수 있다. |
| ZIP 생성 위치 | per-asset과 전체 배치 모두 **제한된 서버 스트리밍 ZIP**으로 통일한다. 지원 런타임에서 스트리밍이 불가능한 경우에만 별도 경로를 재검토한다. |
| `Web safe` 색상 | **프로필 보존이 기본값**이다. ICC와 CICP를 각각 검증하고, 동등한 신호를 증명하지 못한 포맷 후보는 제외한다. 사용자가 `Web safe`를 명시적으로 선택할 때만 sRGB로 변환한다. |

## 13. 근거 자료

모든 링크는 2026-09-06에 다시 확인했다.

- **E1** — [HTTP Archive, Web Almanac 2025: Page Weight](https://almanac.httparchive.org/en/2025/page-weight): 총 이미지 바이트, 요청 수, 포맷별 응답 크기, LCP와 페이지 용량
- **E2** — [HTTP Archive, Web Almanac 2024: Media](https://almanac.httparchive.org/en/2024/media): 포맷 점유, `srcset`/`sizes`/`picture`, alt, 치수, lazy loading, GIF·영상, 외부 이미지 호스트
- **E3** — [MDN: Responsive images](https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Responsive_images): 해상도 전환과 아트 디렉션의 표준 구현
- **E4** — [MDN: Image file type and format guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types): JPEG/PNG/GIF/WebP/AVIF/SVG의 용도·fallback·기능
- **E5** — [W3C WAI: Images Tutorial](https://www.w3.org/WAI/tutorials/images/): 정보·장식·기능·복합 이미지별 대체 텍스트
- **E6** — [Next.js 16: Image Optimization](https://nextjs.org/docs/app/getting-started/images), [Image Component API](https://nextjs.org/docs/app/api-reference/components/image): 올바른 크기, CLS, 현대 포맷, `sizes`, `preload`, placeholder
- **E7** — [Figma: Export static designs](https://help.figma.com/hc/en-us/articles/360040028114-Export-static-designs-from-Figma), [Export formats and settings](https://help.figma.com/hc/en-us/articles/13402894554519-Export-formats-and-settings-for-static-designs): 포맷, 배율, suffix, 품질, 리샘플링, bulk export, 폴더 이름
- **E8** — [Figma: Manage color profiles](https://help.figma.com/hc/en-us/articles/360039825114-Manage-color-profiles-in-design-files): sRGB/Display P3 할당·변환·내보내기
- **E9** — [Cloudinary: Responsive HTML](https://cloudinary.com/documentation/responsive_html), [Image resizing and cropping](https://cloudinary.com/documentation/resizing_and_cropping), [Image transformation types](https://cloudinary.com/documentation/image_transformation_types): 반응형 breakpoint, 크롭, format/quality, overlay
- **E10** — [Sharp: Output options](https://sharp.pixelplumbing.com/api-output/), [Sharp: Resizing images](https://sharp.pixelplumbing.com/api-resize/), [ImageMagick command-line options](https://imagemagick.org/command-line-options/), [ImageMagick color management](https://imagemagick.org/color-management/): 포맷·메타데이터·trim·crop·compare·ICC 변환 구현 가능성
- **E11** — [Open Graph protocol](https://ogp.me/), [Next.js: Metadata and OG images](https://nextjs.org/docs/app/getting-started/metadata-and-og-images), [Google Search favicon guidelines](https://developers.google.com/search/docs/appearance/favicon-in-search): 소셜 카드와 웹 아이콘 규약
- **E12** — [W3C: Understanding contrast minimum](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html), [W3C: Designing for Web Accessibility](https://www.w3.org/WAI/tips/designing/): 텍스트·UI 대비 요구
- **E13** — [web.dev: Replace animated GIFs with video](https://web.dev/articles/replace-gifs-with-videos), [web.dev: Video performance](https://web.dev/learn/performance/video-performance): GIF 대체, MP4/WebM, poster와 loading
- **E14** — [HTTP Archive, Web Almanac 2025: Fonts](https://almanac.httparchive.org/en/2025/fonts), [WOFF2 specification](https://www.w3.org/TR/WOFF2/), [FontTools subset](https://fonttools.readthedocs.io/en/stable/subset/index.html): WOFF2, 파일 크기, CJK·아이콘 폰트 서브셋
- **E15** — [Apple Support: Using HEIF or HEVC media](https://support.apple.com/en-gb/116944), [Android supported media formats](https://developer.android.com/media/platform/supported-formats): 모바일 캡처·호환 포맷
- **E16** — [GoogleChromeLabs Squoosh](https://github.com/GoogleChromeLabs/squoosh): 다양한 코덱과 로컬 처리 프라이버시
- **E17** — [SVGO preset-default](https://svgo.dev/docs/preset-default/), [SVGO removeScripts](https://svgo.dev/docs/plugins/removeScripts/): SVG 정리·최적화와 실행 콘텐츠 제거 범위
- **E18** — [Cloudinary background removal](https://cloudinary.com/documentation/background_removal): AI 배경 제거의 기능·처리 특성
- **E19** — [W3C Web App Manifest](https://www.w3.org/TR/appmanifest/), [Android Image Asset Studio](https://developer.android.com/studio/write/create-app-icons), [Android adaptive icons](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive), [Apple app icons](https://developer.apple.com/design/human-interface-guidelines/app-icons/), [Apple app icon catalog](https://developer.apple.com/documentation/xcode/configuring-your-app-icon): maskable/monochrome·safe zone·밀도·플랫폼 아이콘 변형
- **E20** — [Wolt BlurHash](https://github.com/woltapp/blurhash): 짧은 문자열 기반 이미지 placeholder와 구현 범위

## 14. 다음 조사에서 보완할 증거

- 현재 사용자 또는 소유자의 최근 20~30개 실제 에셋 작업을 유형별로 분류
- 각 작업에서 사용한 외부 도구 수, 반복 내보내기 횟수, 총 소요 시간 기록
- P0 prototype으로 정적 HTML, Next.js, 디자인 핸드오프 과제 각 5회 관찰
- AVIF/WebP/JPEG/PNG를 사진·스크린샷·알파·wide-gamut 코퍼스에서 인코딩 시간과 사람 승인 품질로 비교
- 배경 제거, OG, 아이콘, 폰트 중 제한형 R1로 완료되지 않은 실제 작업과 외부 도구 전환을 기록해 다음 상한 확장 여부 결정

이 데이터가 쌓이면 `D 수요 근거`와 `I 결과 영향`을 다시 계산해 v2 우선순위를 만든다.
