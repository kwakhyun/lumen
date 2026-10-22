# 제3자 코드와 라이선스

Lumen에는 아래 제3자 코드와 npm 의존성이 포함됩니다. 각 라이선스의 저작권 및 사용 조건을 유지해야 합니다. 이 문서는 Lumen 자체 코드에 새로운 라이선스를 부여하지 않습니다. 공개 저장소라는 사실만으로 모든 코드에 임의의 재사용 허가가 부여되는 것은 아닙니다.

## 저장소에 포함된 코드

| 구성 요소 | 포함 위치 | 유지하는 고지 |
| --- | --- | --- |
| OpenAI Sites Vite plugin 기반 코드 | `build/sites-vite-plugin.ts` | [MIT License — Copyright (c) 2026 OpenAI](build/sites-vite-plugin.LICENSE) |
| shadcn 스타일 및 이를 바탕으로 한 UI 구성 | `vendor/shadcn-tailwind-4.13.0.css`, `components/ui/` | [MIT License — Copyright (c) 2023 shadcn](vendor/shadcn-tailwind-4.13.0.LICENSE.md) |

Sites Vite plugin 파일에 원본 패키지 및 수정 기반을 표시하는 주석이 있습니다. 위 라이선스 파일의 전체 문구를 삭제하지 마세요.

## npm 의존성

정확한 설치 버전과 배포 출처는 [package-lock.json](package-lock.json)에 고정돼 있습니다. 직접 의존성은 [package.json](package.json)에 있습니다. React, Vinext, Vite, Cloudflare 도구, Drizzle, shadcn과 Radix 계열 UI, Lucide, Recharts 등은 각 패키지에 포함된 라이선스를 따릅니다.

잠금 파일에는 MIT와 Apache-2.0 외에 MPL-2.0, LGPL-3.0-or-later, BSD, ISC, CC-BY-4.0 등의 라이선스가 포함됩니다. 예를 들어 개발 도구의 선택적 `sharp-libvips` 바이너리는 LGPL 계열이며, Lightning CSS와 일부 렌더링 도구는 MPL-2.0입니다. 모든 의존성이 같은 라이선스인 것으로 표시하면 안 됩니다.

이 저장소는 `node_modules/`와 빌드된 실행 바이너리를 포함하지 않습니다. 설치 시 각 패키지를 npm에서 받습니다. 의존성을 수정하거나 바이너리 및 번들로 재배포할 때는 해당 배포물의 실제 라이선스와 고지 조건을 다시 확인하세요. 잠금 파일의 라이선스 문자열은 패키지 원문의 전체 조건을 대신하지 않습니다.

## 분석에 사용한 도구

REA는 제품 조사 과정에서 사용한 도구이며 이 공개 소스의 런타임이나 vendored 코드에 포함되지 않습니다. Soha의 소스 코드나 브랜드 자산을 이 저장소의 구성 요소로 배포하지 않습니다.
