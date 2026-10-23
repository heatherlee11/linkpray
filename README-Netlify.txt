2027 LINK PRAY ROOM — 배포 / 업데이트 안내
=========================================

배포 ZIP은 GitHub에 연결해 Netlify가 배포하는 프로젝트입니다. 정적 파일만 끌어다 놓는 방식은 Netlify Functions를 배포하지 못할 수 있습니다.

파일 구성
- public/index.html, public/app.js : 공개 사이트 화면과 동작
- public/theme.css, public/assets/link-logo.png : 화이트·버건디 디자인과 최적화한 로고
- netlify.toml : public 폴더 공개, Functions 위치 지정
- netlify/functions/ : Supabase 설정 반환 및 연락처 로그인 함수
- supabase-setup.sql : 최초 DB 설정
- supabase-update-prayer-responses.sql : 기존 DB에 기도응답 열 추가
- supabase-topic-prayer-time-update.sql : 회원분류 선택, 관리자 회원정보 수정 권한, 공통 기도제목별 게시 기간/누적 기도시간 추가
- supabase-admin-prayer-update.sql : 관리자 RLS 수정, 공통 기도제목과 관리자 기능 관련 기존 DB 업데이트
- supabase-shared-prayer-topics-update.sql (주제 필드 변경 포함) : 공통 기도제목 주제/제목/내용 및 상태(게시/미게시/완료), 게시 항목만 공개, 여러 건 게시를 위한 기존 DB 업데이트

기존 GitHub 저장소에 업데이트할 때
압축을 풀고 ZIP 안의 모든 파일/폴더를 저장소 루트에 복사해 덮어쓴 뒤 commit/push 합니다. Netlify가 자동으로 새 배포를 시작합니다. Build command는 비워두고 netlify.toml이 적용되게 둡니다.

Supabase 최초 설정
1. 새 Supabase 프로젝트를 만듭니다.
2. SQL Editor에서 supabase-setup.sql을 한 번 실행합니다.
3. Netlify 배포 주소를 Supabase Authentication > URL Configuration의 Site URL과 Redirect URLs에 등록합니다.
4. Authentication > Sign In / Providers > Email에서 Email 가입과 이메일 확인을 켭니다.

기존 프로젝트에서 기도응답 기능만 적용
SQL Editor에서 supabase-update-prayer-responses.sql을 한 번 실행합니다.

기존 프로젝트에서 공통 기도제목 이름/내용, 게시 상태별 관리 및 여러 건 게시 기능 적용
SQL Editor에서 supabase-shared-prayer-topics-update.sql을 한 번 실행합니다. 이 스크립트는 현재 기도제목을 기록으로 옮기고, 이전 기록은 완료로 분류하며 가장 최근 기도제목을 게시 상태로 둡니다. 이후 기도실에는 게시 상태만 표시됩니다. 최초 설치가 아니라면 supabase-setup.sql을 다시 실행하지 마세요.

기존 프로젝트에서 최근 기능 업데이트
1. 기존에 관리자 기능/공통기도제목 업데이트 SQL을 실행하지 않았다면 먼저 supabase-admin-prayer-update.sql 및 supabase-shared-prayer-topics-update.sql을 실행합니다.
2. 그다음 supabase-topic-prayer-time-update.sql 전체를 SQL Editor에서 실행합니다. 관리자 회원분류 수정, 완료 기도제목 공개, 주제별 게시 기간과 기도시간 집계 기능을 설정합니다.
3. ZIP의 파일을 기존 GitHub 저장소 루트에 복사해 덮어쓰고 commit/push 합니다. Netlify 새 배포가 끝나면 확인합니다. 최초 설치가 아니라면 supabase-setup.sql을 다시 실행하지 마세요.

Netlify 환경변수
Project configuration > Environment variables에서 아래 세 값을 등록하고 새 배포합니다. 함수가 읽을 수 있도록 Functions scope를 포함합니다.
SUPABASE_URL = Supabase Project URL
SUPABASE_ANON_KEY = Supabase anon/public key
SUPABASE_SERVICE_ROLE_KEY = Supabase service_role key (비밀키, 코드/GitHub에 절대 넣지 않기)

관리자 계정 설정
1. 일반 회원가입으로 별도 관리자 이메일 계정을 만들고 이메일 인증을 끝냅니다.
2. Supabase Dashboard > Authentication > Users에서 그 사용자의 UUID를 복사합니다.
3. SQL Editor에서 UUID를 실제 값으로 바꿔 아래 문장을 실행합니다.
   update public.profiles set role='admin' where id='사용자-UUID';
4. 해당 계정에서 로그아웃 후 다시 로그인합니다. 상단 관리자 메뉴에서 관리자 화면으로 들어갑니다.

기능 메모
- 마이페이지 진입 시 로그인 이메일과 비밀번호를 다시 확인합니다.
- 이메일 인증메일을 보낸 뒤 링크를 확인하고 회원가입 버튼을 누릅니다.
- 회원 연락처는 DB에 숫자만 저장하고 입력 화면에는 010-0000-0000 형식으로 보여줍니다.
- 기도 시작 시 서버에 시작시각을 저장하고, 기도 마치기 시 경과초를 저장합니다. 새로고침한 경우 활성 기도 기록을 이어서 마칠 수 있습니다.
- 기도 응답 기능을 위해 personal_prayer_topics에 response_content / responded_at 열이 추가됩니다.
- 공통 기도제목은 제목/내용과 게시 기간 중 전체 기도실에서 기록된 누적 기도시간을 표시합니다. 완료 항목은 기도실 아래쪽 이전 기도제목에 제목과 시간으로 남습니다.
- 로그인한 사용자가 기도실에 들어오면 Supabase Realtime Presence로 이름을 즉시 공유하며, 화면이 열려 있는 동안 기도 중 상태도 5초 간격으로 갱신합니다.
- 관리자는 전체 또는 회원별 누적 기도시간을 초기화할 수 있습니다. 초기화 시 완료된 기도기록은 삭제되고 진행 중인 기도는 초기화 시점부터 계산됩니다.
- 관리자 배경음악 설정은 업로드 음원 또는 개별 YouTube 영상 링크 중 하나를 사용합니다. YouTube 플레이어는 기도 시작 버튼을 눌러 재생합니다.
- 개인 프로필, 기도기록, 기도제목은 RLS로 본인만 조회할 수 있고, 관리자 계정은 개인 기도제목과 이름/그룹 정보를 관리자 화면에서 확인할 수 있습니다. 현재 기도 중인 이름과 전체 누적 시간은 공개됩니다.
- 관리자 음원은 40MB 이하 파일을 올리고, 사용 허가를 받은 음원만 이용하세요.


최근 업데이트 안내
- 기존 Supabase 프로젝트는 supabase-topic-prayer-time-update.sql을 SQL Editor에서 실행한 뒤 웹 파일을 배포합니다. 이 스크립트는 관리자 프로필 수정 권한, 공통 기도제목 공개 범위, 주제별 게시 기간 기록 및 누적시간 조회를 설정합니다. 기존 완료 주제의 정확한 게시/완료 시각은 데이터베이스에 저장되어 있지 않아 생성 시각부터 마이그레이션 시점까지로 추정합니다. 새 주제는 게시/완료 시각을 정확히 기록합니다.
- 회원가입의 그룹/다락방/순은 지정된 목록에서 선택하며, 관리자 화면에서 기존 회원의 값을 수정할 수 있습니다.
- 이메일 변경은 새 이메일 주소에서 인증 링크를 확인하면 완료됩니다. Supabase Dashboard의 Authentication > Sign In / Providers > Email에서 Secure email change를 끄면 새 이메일만 인증하도록 설정할 수 있습니다. Redirect URLs에 배포 사이트 주소가 등록되어 있어야 합니다.
- 공통 기도제목별 누적시간은 해당 주제가 게시된 구간과 전체 회원의 기도 세션이 겹친 시간을 합산합니다. 기존 완료 주제의 과거 게시/완료 시각은 기록돼 있지 않아 생성 시각부터 이번 SQL 적용 시각까지로 추정하며, 이후 상태변경은 정확히 저장합니다. 동시에 여러 주제가 게시되어 있으면 같은 기도 세션 시간이 각 주제의 게시 기간 합계에 각각 포함될 수 있습니다.

공통 기도제목 주제 입력 업데이트 (기존 Supabase 프로젝트)
-------------------------------------------------------
배포 전에 SQL Editor에서 supabase-prayer-topic-subject-update.sql을 한 번 실행해 room_prayer_topics 테이블에 주제 필드를 추가하세요. 이후 주제, 제목, 내용 순서로 작성할 수 있고, 관리자 공통 기도제목 목록 아래에서 주제별 합계와 각 제목별 누적 기도시간을 확인할 수 있습니다.

One-file SQL update for an existing project
-------------------------------------------
For an existing Supabase project, you can run supabase-existing-project-all-updates.sql once instead of running each incremental update file separately. Do not run supabase-setup.sql on an existing project. For a brand-new project, follow the Supabase first-install steps above.
