# Coin Market Trading — Design System

Toss SEED-inspired, Black Primary Theme  
Cross-platform: iOS · Android · Web (Expo)

---

## 디자인 철학

- **토스 SEED 시스템** 기반의 컴포넌트 구조
- **Black Primary** — 차트·숫자 중심 트레이딩 앱에 최적화된 모노크롬 팔레트
- **한국 주식/코인 UX 관행** — 빨강(상승) / 파랑(하락) 시멘틱 컬러
- **4px 기반 스페이싱** 그리드
- **Pretendard** 폰트 (한/영 최적화)

---

## Token Structure

```
src/design-system/tokens/
├── colors.ts        — palette (raw) + semantic aliases
├── typography.ts    — fontFamily, fontSize, textStyles
├── spacing.ts       — 4px grid + semantic aliases
├── border-radius.ts — component radius map
├── shadows.ts       — cross-platform shadow/elevation
├── animation.ts     — duration, easing, spring configs
└── index.ts         — re-exports
```

---

## Typography Scale

| Variant        | Size | Weight | Usage                        |
|----------------|------|--------|------------------------------|
| `display2`     | 36px | 700    | 히어로 숫자, 메인 가격         |
| `display1`     | 32px | 700    | 대형 타이틀                   |
| `title1`       | 28px | 700    | 화면 제목                     |
| `title2`       | 24px | 700    | 섹션 대제목                   |
| `title3`       | 22px | 600    | 카드 대제목                   |
| `heading1`     | 20px | 600    | 섹션 헤딩                     |
| `heading2`     | 18px | 600    | 카드 헤딩                     |
| `heading3`     | 17px | 600    | 서브 헤딩                     |
| `body1`        | 16px | 400    | 본문                          |
| `body1Medium`  | 16px | 500    | 강조 본문                     |
| `body2`        | 15px | 400    | 보조 본문                     |
| `label1`       | 14px | 500    | 버튼, 탭                      |
| `label1Bold`   | 14px | 600    | 강조 레이블                   |
| `label2`       | 13px | 500    | 칩, 태그                      |
| `caption1`     | 12px | 400    | 도움말, 메타데이터             |
| `caption2`     | 11px | 400    | 타임스탬프, 최소 텍스트        |
| `numericLarge` | 32px | 700    | 코인 가격 (tabular)           |
| `numericMedium`| 22px | 600    | 중형 숫자                     |
| `numericSmall` | 16px | 500    | 소형 숫자                     |

---

## Color Tokens

### Primary
```
primary.default    #000000  브랜드 메인
primary.foreground #FFFFFF  메인 위 텍스트
```

### Semantic
```
positive.*   green — 성공, 완료
negative.*   red   — 오류, 경고
cautious.*   orange — 주의
informative.* blue  — 정보
```

### Market (한국 관행)
```
market.rise    #FF4747  상승 (빨강)
market.fall    #246CF9  하락 (파랑)
market.neutral #737373  보합
```

---

## Components

| Component  | Variants                                  | Sizes        |
|------------|-------------------------------------------|--------------|
| `Text`     | all textStyle variants                    | —            |
| `Button`   | primary, secondary, outline, ghost, danger | sm, md, lg  |
| `Input`    | default, filled, underline                | sm, md, lg   |
| `Card`     | elevated, outlined, filled, flat          | —            |
| `Chip`     | default, selected, positive, negative, cautious | sm, md |
| `Badge`    | default, positive, negative, cautious, informative | sm, md, lg |
| `Divider`  | horizontal, vertical · hairline, thin, thick | —        |
| `Avatar`   | image or initials fallback                | xs–xl        |

---

## Figma Upload

### Option A — Variables API (자동, Professional 플랜 필요)
```bash
cp .env.example .env
# .env 파일에 FIGMA_TOKEN, FIGMA_FILE_KEY 입력
npm run figma:upload
```

### Option B — Token Studio 플러그인 (무료, 수동)
1. Figma에서 **Token Studio** 플러그인 설치
   https://www.figma.com/community/plugin/843461159747178978
2. 플러그인 열기 → **Load from file** → `design-tokens.json` 선택
3. Apply tokens to document

---

## 파일 구조

```
design-tokens.json          — W3C Design Tokens (Token Studio 호환)
src/design-system/
  tokens/                   — TypeScript 토큰 소스
  components/               — React Native 컴포넌트
scripts/
  figma-upload.ts           — Figma Variables API 업로드
  generate-tokens-json.ts   — tokens → JSON 재생성
```
