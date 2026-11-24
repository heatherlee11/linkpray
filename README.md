2027 LINK PRAY ROOM — GitHub 배포 파일

GitHub에 이 압축파일의 안쪽 파일과 폴더를 저장소 최상위에 올립니다.
Netlify 설정은 netlify.toml에 있으며 publish 폴더는 public입니다.

Netlify 환경변수
- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY (비공개로 보관하고 HTML/GitHub에 넣지 마세요)

기존 Supabase 프로젝트를 사용하는 경우 별도 SQL 파일(supabase-existing-project-all-updates.sql)을 실행하고, 프로필 접근 권한을 정리하려면 supabase-profile-privacy-hardening.sql도 실행합니다. SQL 파일은 별도의 SQL 압축파일에 있습니다.
이 패키지의 JavaScript, CSS, HTML은 읽기 어렵도록 압축되어 있습니다. 브라우저로 내려가는 코드이므로 개발자 도구에서 완전히 숨겨지지는 않습니다.
