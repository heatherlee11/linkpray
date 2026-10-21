let createClient = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const fmt = (seconds) => [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), Math.floor(seconds % 60)]
  .map((part) => String(part).padStart(2, '0')).join(':');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const phoneFormat = (value) => {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
};
const phoneDigits = (value) => String(value || '').replace(/\D/g, '');
function youtubeVideoId(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0]?.match(/^[A-Za-z0-9_-]{11}$/)?.[0] || null;
    if (!['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com'].includes(host)) return null;
    const watchId = url.searchParams.get('v');
    if (watchId && /^[A-Za-z0-9_-]{11}$/.test(watchId)) return watchId;
    return url.pathname.match(/\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})(?:$|\/)/)?.[1] || null;
  } catch { return null; }
}

function youtubeEmbedUrl(videoId) {
  const params = new URLSearchParams({ autoplay: '0', controls: '1', enablejsapi: '1', loop: '1', playlist: videoId, playsinline: '1', origin: window.location.origin });
  return `https://www.youtube.com/embed/${videoId}?${params}`;
}

function sendYouTubeCommand(func) {
  if ($('#youtubeWrap').classList.contains('hidden')) return;
  $('#youtubePlayer').contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), 'https://www.youtube.com');
}

function startPrayerMusic() {
  if (!$('#youtubeWrap').classList.contains('hidden')) {
    sendYouTubeCommand('playVideo');
    return;
  }
  if ($('#audio').getAttribute('src')) $('#audio').play().catch(() => toast('음악 플레이어의 재생 버튼을 눌러주세요.'));
}

function pausePrayerMusic() {
  $('#audio').pause();
  sendYouTubeCommand('pauseVideo');
}

let supabase = null;
let configured = false;
let user = null;
let profile = null;
let activeSessionId = null;
let activeStartedAt = 0;
let completedPrayerSeconds = 0;
let prayerTicker = null;
let adminLoginPending = false;
let initialized = false;
let roomPollerStarted = false;
let adminPrayerHistory = [];
let editingSharedPrayerTopicId = null;
let roomPresenceChannel = null;
let roomPresenceStatus = 'CLOSED';
let roomPresenceTracked = false;
let roomVisitors = [];
let activePrayerPeople = [];
let prayingUserIds = new Set();
let adminMembers = new Map();

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 3000);
}

function page(id) {
  $$('.page').forEach((section) => section.classList.toggle('active', section.id === id));
  $$('.nav [data-page]').forEach((button) => button.classList.toggle('active', button.dataset.page === id));
  window.scrollTo(0, 0);
  if (id === 'mypage') loadMine();
  if (id === 'admin' && profile?.role === 'admin') loadAdminData();
  if (id === 'room') {
    refreshPresence();
    startRoomPresence();
  } else {
    stopRoomPresence();
  }
}

function authTab(tab) {
  $$('[data-auth-tab]').forEach((button) => button.classList.toggle('active', button.dataset.authTab === tab));
  $('#loginForm').classList.toggle('active', tab === 'login');
  $('#signupForm').classList.toggle('active', tab === 'signup');
  if (tab === 'signup') refreshSignupGate();
}

window.openAuth = (tab = 'login') => {
  if (!configured) return toast('Supabase 연결 설정 후 로그인을 사용할 수 있어요.');
  $('#authModal').classList.add('open');
  authTab(tab);
};

function refreshSignupGate() {
  const email = $('#signupForm [name="email"]').value.trim().toLowerCase();
  const verified = !!(user && user.email_confirmed_at && user.email?.toLowerCase() === email);
  $('#completeSignup').disabled = !verified;
  $('#signupForm [name="password"]').required = !verified;
  $('#emailVerifyStatus').textContent = verified
    ? '이메일 인증이 확인됐어요. 회원가입을 완료해 주세요.'
    : (localStorage.getItem('linkpray-pending-email') === email && email
      ? '인증메일의 링크를 눌러 인증을 마친 뒤 이 화면으로 돌아오세요.'
      : '이메일 인증을 먼저 진행해 주세요.');
}

function showProfile() {
  $('#signedOut').classList.toggle('hidden', !!user);
  $('#myContent').classList.toggle('hidden', !user);
  if (!user) return;
  $('#myName').textContent = profile?.name || '기도자';
  $('#profileName').value = profile?.name || '';
  $('#profilePhone').value = phoneFormat(profile?.phone || '');
  $('#profileCohort').value = profile?.cohort || '';
  $('#profileGroup').value = profile?.group_name || '';
  $('#profileDarabang').value = profile?.darabang || '';
  $('#profileSoon').value = profile?.soon || '';
  $('#profileEmailInput').value = user.email || '';
  updateEmailChangeState();
  $('#myProfileDetails').textContent = [profile?.cohort && `${profile.cohort}기`, profile?.group_name,
    profile?.darabang, profile?.soon && `${profile.soon}순`].filter(Boolean).join(' · ');
}

function updateEmailChangeState() {
  if (!user) return;
  const pending = localStorage.getItem('linkpray-pending-email-change')?.trim().toLowerCase();
  const applied = !!(pending && user.email_confirmed_at && user.email?.toLowerCase() === pending);
  $('#emailReauthBox').classList.toggle('hidden', !applied);
  $('#emailChangeStatus').textContent = applied
    ? '새 이메일 인증이 확인됐어요. 비밀번호를 다시 입력해 변경을 확정해 주세요.'
    : (pending
      ? `Supabase 이메일 변경 설정에 따라 새 주소와 기존 주소에서 인증을 완료한 뒤 이 화면으로 돌아오세요. (요청: ${pending})`
      : '이메일을 변경하려면 새 주소로 인증을 완료해 주세요.');
  $('#confirmEmailChange').disabled = !applied;
}

async function requestEmailChange() {
  const email = $('#profileEmailInput').value.trim().toLowerCase();
  if (!email || !$('#profileEmailInput').checkValidity()) return toast('올바른 이메일 주소를 입력해 주세요.');
  if (email === user.email?.toLowerCase()) return toast('현재 이메일과 다른 주소를 입력해 주세요.');
  const { error } = await supabase.auth.updateUser(
    { email },
    { emailRedirectTo: `${window.location.origin}${window.location.pathname}` }
  );
  if (error) return toast(error.message);
  localStorage.setItem('linkpray-pending-email-change', email);
  updateEmailChangeState();
  toast('인증메일을 보냈어요. 메일 안내에 따라 인증을 완료해 주세요.');
}

async function confirmEmailChange() {
  const email = localStorage.getItem('linkpray-pending-email-change')?.trim().toLowerCase();
  const password = $('#emailReauthPassword').value;
  if (!email || !password) return toast('계정 비밀번호를 입력해 주세요.');
  if (!user.email_confirmed_at || user.email?.toLowerCase() !== email) return toast('새 이메일 인증이 아직 완료되지 않았어요.');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return toast('비밀번호를 확인해 주세요.');
  user = data.user;
  localStorage.removeItem('linkpray-pending-email-change');
  $('#emailReauthPassword').value = '';
  await init();
  toast('이메일 변경을 확정했어요.');
}

async function init() {
  if (!configured) return;
  const { data: { session } } = await supabase.auth.getSession();
  user = session?.user || null;
  profile = null;
  if (user) {
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    profile = data || {};
    const pendingEmail = localStorage.getItem('linkpray-pending-email');
    if (pendingEmail && pendingEmail.toLowerCase() === user.email?.toLowerCase()) {
      const signup = $('#signupForm');
      signup.elements.email.value = user.email;
      signup.elements.phone.value = phoneFormat(profile.phone || '');
      signup.elements.name.value = profile.name || '';
      signup.elements.cohort.value = profile.cohort || '';
      signup.elements.group_name.value = profile.group_name || '';
      signup.elements.darabang.value = profile.darabang || '';
      signup.elements.soon.value = profile.soon || '';
      $('#emailVerifyStatus').textContent = '이메일 인증이 확인됐어요. 회원가입을 완료해 주세요.';
    }
  }
  $('#authButton').classList.toggle('hidden', !!user);
  $('#logoutButton').classList.toggle('hidden', !user);
  $('#adminNav').classList.remove('hidden');
  $('#homeMyStat').classList.toggle('hidden', !user);
  showProfile();
  refreshSignupGate();
  await loadRoom();
  if (user) {
    await loadMine();
    await restoreActivePrayer();
  }
  if ($('#room').classList.contains('active')) startRoomPresence();
  if (adminLoginPending && user) {
    adminLoginPending = false;
    if (profile?.role === 'admin') page('admin');
    else toast('이 계정은 관리자 권한이 없어요.');
  }
  initialized = true;
}

async function restoreActivePrayer() {
  const { data: active } = await supabase.from('active_prayers').select('session_id,started_at').eq('user_id', user.id).maybeSingle();
  if (!active) return;
  activeSessionId = active.session_id;
  activeStartedAt = Date.parse(active.started_at);
  $('#startBtn').classList.add('hidden');
  $('#stopBtn').classList.remove('hidden');
  $('#timerHint').textContent = '기도 중 · 기도 마치기를 누르면 시간이 저장됩니다';
  startTicker();
}

async function loadRoom() {
  if (!configured) return;
  const [{ data: settings }, { data: sharedTopics }] = await Promise.all([
    supabase.from('room_settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('room_prayer_topics').select('id,title,content,created_at').order('created_at', { ascending: false })
  ]);
  if (settings) {
    $('#youtubeUrl').value = settings.youtube_url || '';
    const roomSharedPrayerTopics = sharedTopics || [];
    const legacyTopic = settings.prayer_topic ? [{ title: '', content: settings.prayer_topic }] : [];
    renderRoomPrayerTopics(roomSharedPrayerTopics.length ? roomSharedPrayerTopics : legacyTopic);
    const videoId = settings.youtube_url ? youtubeVideoId(settings.youtube_url) : null;
    if (videoId) {
      const embedUrl = youtubeEmbedUrl(videoId);
      if ($('#youtubePlayer').src !== embedUrl) $('#youtubePlayer').src = embedUrl;
      $('#youtubeWrap').classList.remove('hidden');
      $('#audio').classList.add('hidden');
      $('#musicName').textContent = 'YouTube 배경음악';
    } else {
      $('#youtubeWrap').classList.add('hidden');
      $('#youtubePlayer').removeAttribute('src');
      $('#audio').classList.toggle('hidden', !settings.audio_url);
      $('#musicName').textContent = settings.audio_name || '배경음악';
    }
    if (settings.audio_url && !videoId) {
      $('#audio').src = settings.audio_url;
    } else if (!videoId) {
      $('#audio').removeAttribute('src');
    }
  }
  await refreshPresence();
  await refreshTotal();
  if (!window.prayerRoomChannel) {
    window.prayerRoomChannel = supabase.channel('prayer-room-data')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'active_prayers' }, async () => {
        await refreshPresence();
        await refreshTotal();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_settings' }, async () => {
        await loadRoom();
        await refreshTotal();
        if (user) await loadMine();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_prayer_topics' }, loadRoom)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') refreshPresence();
      });
  }
  if (!roomPollerStarted) {
    roomPollerStarted = true;
    setInterval(() => {
      if ($('#room').classList.contains('active')) {
        refreshPresence();
        startRoomPresence();
      }
    }, 5000);
    setInterval(refreshTotal, 30000);
  }
}

function renderRoomPrayerTopics(topics) {
  const roomTopic = $('#roomTopic');
  if (!roomTopic) return;
  roomTopic.innerHTML = topics.length
    ? topics.map((topic) => `<article class="room-topic-entry">${topic.title?.trim() ? `<h3>${esc(topic.title)}</h3>` : ''}<p>${esc(topic.content)}</p></article>`).join('')
    : '<p>주님, 이 공간을 찾는 모든 이에게 평안과 소망을 주세요.</p>';
}

async function refreshPresence() {
  const { data, error } = await supabase.from('active_prayers').select('user_id,display_name,started_at,session_id');
  if (error) return;
  activePrayerPeople = data || [];
  prayingUserIds = new Set(activePrayerPeople.map((person) => person.user_id));
  const myLivePrayer = activeSessionId && activePrayerPeople.find((person) => person.user_id === user?.id && person.session_id === activeSessionId);
  if (myLivePrayer) {
    const serverStartedAt = Date.parse(myLivePrayer.started_at);
    if (Number.isFinite(serverStartedAt) && serverStartedAt !== activeStartedAt) {
      activeStartedAt = serverStartedAt;
      startTicker();
      loadMine();
    }
  }
  const state = roomPresenceChannel?.presenceState?.() || {};
  const visitorById = new Map();
  Object.values(state).flat().forEach((visitor) => {
    if (visitor.user_id) visitorById.set(visitor.user_id, visitor.display_name || '기도자');
  });
  roomVisitors = [...visitorById.entries()].map(([user_id, display_name]) => ({ user_id, display_name }));
  renderRoomVisitors();
}

function renderRoomVisitors() {
  const people = roomPresenceStatus === 'SUBSCRIBED'
    ? roomVisitors
    : activePrayerPeople.map(({ user_id, display_name }) => ({ user_id, display_name }));
  $('#homeCount').textContent = people.length;
  $('#countLabel').textContent = `${people.length}명`;
  $('#people').innerHTML = people.length
    ? people.map((person) => `<div class="person"><span class="dot"></span>${esc(person.display_name)}<span class="pill">${prayingUserIds.has(person.user_id) ? '기도 중' : '함께 있음'}</span></div>`).join('')
    : '<div class="empty">기도실에 입장하면 이름이 여기에 표시돼요.</div>';
}

function startRoomPresence() {
  if (!configured || !user || !$('#room').classList.contains('active')) return;
  if (!roomPresenceChannel) {
    const key = globalThis.crypto?.randomUUID?.() || `room-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    roomPresenceChannel = supabase.channel('link-pray-room-visitors', { config: { presence: { key } } })
      .on('presence', { event: 'sync' }, () => {
        roomVisitors = Object.values(roomPresenceChannel.presenceState()).flat()
          .filter((entry) => entry.user_id)
          .reduce((list, entry) => {
            if (!list.some((person) => person.user_id === entry.user_id)) list.push(entry);
            return list;
          }, [])
          .map((entry) => ({ user_id: entry.user_id, display_name: entry.display_name || '기도자' }));
        renderRoomVisitors();
      })
      .subscribe(async (status) => {
        roomPresenceStatus = status;
        if (status === 'SUBSCRIBED' && user && $('#room').classList.contains('active')) {
          const { error } = await roomPresenceChannel.track({
            user_id: user.id,
            display_name: profile?.name || user.user_metadata?.name || '기도자'
          });
          roomPresenceTracked = !error;
        } else if (status !== 'SUBSCRIBED') {
          roomPresenceTracked = false;
        }
        renderRoomVisitors();
      });
  } else if (roomPresenceStatus === 'SUBSCRIBED' && !roomPresenceTracked) {
    roomPresenceChannel.track({
      user_id: user.id,
      display_name: profile?.name || user.user_metadata?.name || '기도자'
    }).then(({ error }) => { roomPresenceTracked = !error; });
  }
}

function stopRoomPresence() {
  if (roomPresenceChannel && roomPresenceStatus === 'SUBSCRIBED' && roomPresenceTracked) {
    roomPresenceChannel.untrack();
  }
  roomPresenceTracked = false;
}

async function refreshTotal() {
  const { data, error } = await supabase.rpc('public_prayer_total_seconds');
  if (!error) $('#homeTotal').textContent = fmt(Number(data || 0));
}

async function loadMine() {
  if (!user || !configured) return;
  const { data: sessions, error } = await supabase.from('prayer_sessions')
    .select('id,started_at,ended_at,duration_seconds').eq('user_id', user.id).order('started_at', { ascending: false });
  if (error) return;
  completedPrayerSeconds = (sessions || []).reduce((sum, session) => sum + Number(session.duration_seconds || 0), 0);
  const liveSeconds = activeSessionId ? Math.floor((Date.now() - activeStartedAt) / 1000) : 0;
  $('#myTotal').textContent = fmt(completedPrayerSeconds + liveSeconds);
  $('#homeMyTotal').textContent = fmt(completedPrayerSeconds + liveSeconds);
  const { data: topics } = await supabase.from('personal_prayer_topics').select('*')
    .eq('user_id', user.id).order('created_at', { ascending: false });
  $('#myTopics').innerHTML = (topics || []).length ? topics.map(renderPrayerTopic).join('')
    : '<div class="empty">저장된 기도제목이 없습니다.</div>';
}

function renderPrayerTopic(topic) {
  const created = new Date(topic.created_at).toLocaleDateString('ko-KR');
  const response = topic.responded_at
    ? `<div class="answer-box"><strong>${new Date(topic.responded_at).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' }).replace(/\s/g, '')} 기도응답</strong><div>${esc(topic.response_content)}</div></div>`
    : '';
  return `<article class="topic"><small>${created}</small><div>${esc(topic.content)}</div>${response}
    <div class="topic-actions"><button class="response-button" type="button" onclick="window.toggleTopicEdit('${topic.id}')">수정</button>
    <button class="response-button" type="button" onclick="window.deletePrayerTopic('${topic.id}')">삭제</button>
    <button class="response-button" type="button" onclick="window.toggleResponse('${topic.id}')">${topic.response_content ? '응답 수정' : '응답 기록'}</button></div>
    <div class="response-editor hidden" id="topic-editor-${topic.id}"><textarea class="field" id="topic-text-${topic.id}">${esc(topic.content)}</textarea><button class="secondary" type="button" onclick="window.savePrayerTopic('${topic.id}')">수정 저장</button></div>
    <div class="response-editor hidden" id="response-editor-${topic.id}"><textarea class="field" id="response-text-${topic.id}" placeholder="기도 응답 내용을 적어주세요.">${esc(topic.response_content || '')}</textarea><button class="secondary" type="button" onclick="window.savePrayerResponse('${topic.id}')">응답 저장</button></div></article>`;
}

window.toggleTopicEdit = (id) => $(`#topic-editor-${id}`).classList.toggle('hidden');
window.savePrayerTopic = async (id) => {
  const content = $(`#topic-text-${id}`).value.trim();
  if (!content) return toast('기도제목을 입력해 주세요.');
  const { error } = await supabase.from('personal_prayer_topics').update({ content }).eq('id', id).eq('user_id', user.id);
  if (error) return toast(error.message);
  await loadMine();
  toast('기도제목을 수정했어요.');
};
window.deletePrayerTopic = async (id) => {
  if (!window.confirm('이 기도제목을 삭제할까요?')) return;
  const { error } = await supabase.from('personal_prayer_topics').delete().eq('id', id).eq('user_id', user.id);
  if (error) return toast(error.message);
  await loadMine();
  toast('기도제목을 삭제했어요.');
};
window.toggleResponse = (id) => $(`#response-editor-${id}`).classList.toggle('hidden');
window.savePrayerResponse = async (id) => {
  const content = $(`#response-text-${id}`).value.trim();
  if (!content) return toast('기도 응답 내용을 입력해 주세요.');
  const { error } = await supabase.from('personal_prayer_topics').update({ response_content: content, responded_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', user.id);
  if (error) return toast(error.message);
  await loadMine();
  toast('기도 응답을 기록했어요.');
};

function startTicker() {
  clearInterval(prayerTicker);
  const update = () => {
    if (!activeSessionId) return;
    const elapsed = Math.max(0, Math.floor((Date.now() - activeStartedAt) / 1000));
    $('#timer').textContent = fmt(elapsed);
    $('#myTotal').textContent = fmt(completedPrayerSeconds + elapsed);
    $('#homeMyTotal').textContent = fmt(completedPrayerSeconds + elapsed);
  };
  update();
  prayerTicker = setInterval(update, 1000);
}

async function beginPrayer() {
  if (!user) return window.openAuth('login');
  if (activeSessionId) return;
  const clickedAt = Date.now();
  startPrayerMusic();
  const startedAt = new Date(clickedAt).toISOString();
  const { data: session, error } = await supabase.from('prayer_sessions')
    .insert({ user_id: user.id, started_at: startedAt }).select('id,started_at').single();
  if (error) { pausePrayerMusic(); return toast(error.message); }
  const { error: presenceError } = await supabase.from('active_prayers').upsert({
    user_id: user.id, display_name: profile?.name || user.user_metadata?.name || '기도자',
    session_id: session.id, started_at: session.started_at
  });
  if (presenceError) {
    await supabase.from('prayer_sessions').delete().eq('id', session.id);
    pausePrayerMusic();
    return toast(presenceError.message);
  }
  activeSessionId = session.id;
  activeStartedAt = Date.parse(session.started_at);
  if (!Number.isFinite(activeStartedAt)) activeStartedAt = clickedAt;
  $('#startBtn').classList.add('hidden');
  $('#stopBtn').classList.remove('hidden');
  $('#timerHint').textContent = '기도 중 · 기도 마치기를 누르면 시간이 저장됩니다';
  // Start the visible clock before waiting for the browser's audio permission.
  startTicker();
  await refreshPresence();
  toast('기도시간 기록을 시작했어요.');
}

async function stopPrayer() {
  if (!activeSessionId) return;
  clearInterval(prayerTicker);
  const id = activeSessionId;
  const seconds = Math.max(0, Math.floor((Date.now() - activeStartedAt) / 1000));
  const { error } = await supabase.from('prayer_sessions').update({
    ended_at: new Date().toISOString(), duration_seconds: seconds
  }).eq('id', id).eq('user_id', user.id);
  const { error: presenceError } = await supabase.from('active_prayers').delete().eq('user_id', user.id);
  activeSessionId = null;
  activeStartedAt = 0;
  pausePrayerMusic();
  $('#timer').textContent = '00:00:00';
  $('#timerHint').textContent = '로그인 후 기도를 시작할 수 있어요';
  $('#startBtn').classList.remove('hidden');
  $('#stopBtn').classList.add('hidden');
  await refreshPresence();
  await refreshTotal();
  await loadMine();
  if (error || presenceError) toast((error || presenceError).message);
  else toast('시작부터 마칠 때까지의 기도시간을 저장했어요.');
}

async function sendVerificationEmail() {
  const form = $('#signupForm');
  const emailInput = form.elements.email;
  emailInput.value = emailInput.value.trim().toLowerCase();
  if (!form.checkValidity()) return form.reportValidity();
  if (user && user.email?.toLowerCase() === emailInput.value && user.email_confirmed_at) {
    return toast('이미 이 이메일을 인증했어요. 회원가입을 눌러주세요.');
  }
  const values = Object.fromEntries(new FormData(form).entries());
  values.phone = phoneDigits(values.phone);
  if (values.phone.length !== 11 || !values.phone.startsWith('010')) return toast('휴대폰 번호를 010-0000-0000 형식으로 입력해 주세요.');
  $('#verifyEmailBtn').disabled = true;
  try {
    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: { data: {
        name: values.name.trim(), phone: values.phone, cohort: values.cohort.trim(),
        group_name: values.group_name.trim(), darabang: values.darabang.trim(), soon: values.soon.trim()
      } }
    });
    if (error) throw error;
    localStorage.setItem('linkpray-pending-email', values.email);
    if (data.session?.user?.email_confirmed_at) {
      user = data.session.user;
      refreshSignupGate();
      return toast('이메일이 확인됐어요. 회원가입을 눌러주세요.');
    }
    $('#emailVerifyStatus').textContent = '인증메일을 보냈어요. 메일의 인증 링크를 누른 뒤 이 사이트로 돌아오세요.';
    toast('인증메일을 보냈어요.');
  } catch (error) {
    toast(error.message || '인증메일을 보내지 못했어요.');
  } finally {
    $('#verifyEmailBtn').disabled = false;
  }
}

async function completeSignup(event) {
  event.preventDefault();
  await init();
  const email = $('#signupForm [name="email"]').value.trim().toLowerCase();
  if (!user || !user.email_confirmed_at || user.email?.toLowerCase() !== email) {
    refreshSignupGate();
    return toast('인증메일의 링크를 눌러 이메일 인증을 먼저 마쳐주세요.');
  }
  localStorage.removeItem('linkpray-pending-email');
  $('#authModal').classList.remove('open');
  toast('회원가입이 완료됐어요.');
  await init();
}

async function login(event) {
  event.preventDefault();
  const values = new FormData(event.currentTarget);
  const identifier = String(values.get('identifier')).trim();
  const password = String(values.get('password'));
  try {
    let result;
    if (identifier.includes('@')) {
      result = await supabase.auth.signInWithPassword({ email: identifier.toLowerCase(), password });
    } else {
      const response = await fetch('/.netlify/functions/phone-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneDigits(identifier), password })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '로그인에 실패했어요.');
      result = await supabase.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
    }
    if (result.error) throw result.error;
    $('#authModal').classList.remove('open');
    await init();
    toast('로그인했어요.');
  } catch (error) {
    toast(error.message || '로그인에 실패했어요.');
  }
}

async function reauthenticate(event) {
  event.preventDefault();
  const password = $('#reauthPassword').value;
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password });
  if (error) return toast('비밀번호가 맞지 않아요.');
  $('#reauthModal').classList.remove('open');
  $('#reauthPassword').value = '';
  page('mypage');
}

async function saveProfile(event) {
  event.preventDefault();
  const phone = phoneDigits($('#profilePhone').value);
  if (phone.length !== 11 || !phone.startsWith('010')) return toast('휴대폰 번호를 확인해 주세요.');
  const changes = {
    name: $('#profileName').value.trim(), phone, cohort: $('#profileCohort').value.trim(),
    group_name: $('#profileGroup').value.trim(), darabang: $('#profileDarabang').value.trim(), soon: $('#profileSoon').value.trim()
  };
  const { error } = await supabase.from('profiles').update(changes).eq('id', user.id);
  if (error) return toast(error.message);
  profile = { ...profile, ...changes };
  showProfile();
  toast('회원정보를 저장했어요.');
}

async function saveTopic() {
  const content = $('#myTopicInput').value.trim();
  if (!content) return toast('기도제목을 입력해 주세요.');
  const { error } = await supabase.from('personal_prayer_topics').insert({ user_id: user.id, content });
  if (error) return toast(error.message);
  $('#myTopicInput').value = '';
  await loadMine();
  toast('기도제목을 저장했어요.');
}

async function saveAdminTopic() {
  if (profile?.role !== 'admin') return toast('관리자 계정으로 로그인해 주세요.');
  const drafts = $$('#sharedTopicDrafts .shared-topic-entry').map((entry) => ({
    title: entry.querySelector('[data-topic-title]').value.trim(),
    content: entry.querySelector('[data-topic-content]').value.trim()
  }));
  const incomplete = drafts.some((draft) => (!!draft.title !== !!draft.content));
  const ready = drafts.filter((draft) => draft.title && draft.content);
  if (incomplete) return toast('각 기도제목의 이름과 내용을 모두 입력해 주세요.');
  if (!ready.length) return toast('기도제목 이름과 내용을 입력해 주세요.');
  const { error: historyError } = await supabase.from('room_prayer_topics').insert(ready.map((draft) => ({ ...draft, created_by: user.id })));
  if (historyError) return toast(historyError.message);
  $('#sharedTopicDrafts').innerHTML = '';
  appendSharedTopicDraft();
  await loadRoom();
  await loadAdminData();
  toast(`${ready.length}개의 공통 기도제목을 게시했어요.`);
}

function appendSharedTopicDraft() {
  const drafts = $('#sharedTopicDrafts');
  if (!drafts) return;
  const row = document.createElement('div');
  row.className = 'shared-topic-entry';
  row.innerHTML = '<input class="field" data-topic-title maxlength="120" placeholder="기도제목 이름"><textarea class="field" data-topic-content maxlength="2000" placeholder="기도제목 내용"></textarea><button class="response-button remove-shared-draft" type="button">항목 삭제</button>';
  drafts.append(row);
}

window.resetAllPrayerTime = async () => {
  if (profile?.role !== 'admin') return toast('관리자 계정으로 로그인해 주세요.');
  if (!window.confirm('모든 회원의 완료된 기도 기록을 삭제해 전체 누적을 초기화할까요? 진행 중인 기도는 이 시각부터 다시 계산됩니다.')) return;
  const { error } = await supabase.rpc('admin_reset_prayer_time', { target_user_id: null });
  if (error) return toast(error.message);
  await refreshTotal();
  await refreshPresence();
  await loadAdminData();
  if (user) await loadMine();
  toast('전체 기도시간을 초기화했어요.');
};

window.resetMemberPrayerTime = async (memberId) => {
  if (profile?.role !== 'admin') return toast('관리자 계정으로 로그인해 주세요.');
  const member = adminMembers.get(memberId);
  if (!member) return toast('회원을 찾을 수 없어요.');
  const memberName = member.name || '이 회원';
  if (!window.confirm(`${memberName}님의 완료된 기도 기록을 삭제해 누적을 초기화할까요? 진행 중인 기도는 이 시각부터 다시 계산됩니다.`)) return;
  const { error } = await supabase.rpc('admin_reset_prayer_time', { target_user_id: memberId });
  if (error) return toast(error.message);
  await refreshTotal();
  await refreshPresence();
  await loadAdminData();
  if (memberId === user.id) await loadMine();
  toast(`${memberName}님의 기도시간을 초기화했어요.`);
};

async function loadAdminData() {
  if (profile?.role !== 'admin') return;
  const historyEl = $('#adminPrayerHistory');
  const personalEl = $('#adminPersonalTopics');
  if (!historyEl || !personalEl) return;
  historyEl.innerHTML = '<div class="empty">불러오는 중…</div>';
  personalEl.innerHTML = '<div class="empty">불러오는 중…</div>';
  const [{ data: history, error: historyError }, { data: topics, error: topicsError }, { data: members, error: memberError }, { data: sessions, error: sessionsError }, { data: activeRows, error: activeError }] = await Promise.all([
    supabase.from('room_prayer_topics').select('id,title,content,created_at,created_by').order('created_at', { ascending: false }),
    supabase.from('personal_prayer_topics').select('id,user_id,content,created_at,response_content,responded_at').order('created_at', { ascending: false }),
    supabase.from('profiles').select('id,name,cohort,group_name,darabang,soon').order('name'),
    supabase.from('prayer_sessions').select('user_id,started_at,ended_at,duration_seconds'),
    supabase.from('active_prayers').select('user_id,started_at')
  ]);
  if (historyError) historyEl.innerHTML = `<div class="empty">${esc(historyError.message)}</div>`;
  else {
    adminPrayerHistory = history || [];
    renderAdminPrayerHistory();
  }
  const totalsEl = $('#adminPrayerTotals');
  if (memberError || sessionsError || activeError) {
    totalsEl.innerHTML = `<div class="empty">${esc((memberError || sessionsError || activeError).message)}</div>`;
  } else {
    adminMembers = new Map((members || []).map((member) => [member.id, member]));
    const secondsByUser = new Map();
    (sessions || []).filter((session) => session.ended_at).forEach((session) => {
      secondsByUser.set(session.user_id, (secondsByUser.get(session.user_id) || 0) + Number(session.duration_seconds || 0));
    });
    (activeRows || []).forEach((session) => {
      const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(session.started_at)) / 1000));
      secondsByUser.set(session.user_id, (secondsByUser.get(session.user_id) || 0) + seconds);
    });
    const { data: globalSeconds, error: globalError } = await supabase.rpc('public_prayer_total_seconds');
    const memberRows = (members || []).map((member) => {
      const details = [member.cohort && `${member.cohort}기`, member.group_name, member.darabang, member.soon && `${member.soon}순`].filter(Boolean).join(' · ');
      return `<div class="admin-person-row"><div><b>${esc(member.name || '이름 없는 기도자')}</b><small>${esc(details || '회원정보 미입력')}</small></div><strong>${fmt(secondsByUser.get(member.id) || 0)}</strong><button class="secondary" type="button" onclick="resetMemberPrayerTime('${member.id}')">개인 초기화</button></div>`;
    }).join('');
    totalsEl.innerHTML = `${globalError ? '' : `<p class="admin-global-total">전체 누적 <strong>${fmt(Number(globalSeconds || 0))}</strong></p>`}${memberRows || '<div class="empty">등록된 회원이 없어요.</div>'}`;
  }
  if (topicsError) { personalEl.innerHTML = `<div class="empty">${esc(topicsError.message)}</div>`; return; }
  if (!topics?.length) { personalEl.innerHTML = '<div class="empty">등록된 개인 기도제목이 없어요.</div>'; return; }
  const ids = [...new Set(topics.map((item) => item.user_id))];
  const { data: personalMembers, error: membersError } = await supabase.from('profiles').select('id,name,cohort,group_name,darabang,soon').in('id', ids);
  if (membersError) { personalEl.innerHTML = `<div class="empty">${esc(membersError.message)}</div>`; return; }
  const memberById = new Map((personalMembers || []).map((member) => [member.id, member]));
  const grouped = new Map();
  topics.forEach((item) => {
    const member = memberById.get(item.user_id) || {};
    const date = new Date(item.created_at).toLocaleString('ko-KR');
    const response = item.response_content
      ? `<div class="answer-box"><strong>${esc(item.responded_at ? new Date(item.responded_at).toLocaleDateString('ko-KR') : '기도응답')}</strong>${esc(item.response_content)}</div>` : '';
    const group = member.group_name?.trim() || '그룹 미지정';
    const darabang = member.darabang?.trim() || '다락방 미지정';
    if (!grouped.has(group)) grouped.set(group, new Map());
    const rooms = grouped.get(group);
    if (!rooms.has(darabang)) rooms.set(darabang, []);
    rooms.get(darabang).push({ item, member, date, response });
  });
  personalEl.innerHTML = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b, 'ko')).map(([group, rooms]) => {
    const count = [...rooms.values()].reduce((sum, entries) => sum + entries.length, 0);
    const roomMarkup = [...rooms.entries()].sort(([a], [b]) => a.localeCompare(b, 'ko')).map(([darabang, entries]) =>
      `<section class="admin-darabang-group"><h5>${esc(darabang)} <span>${entries.length}개</span></h5>${entries.map(({ item, member, date, response }) => {
        const metadata = [member.cohort && `${member.cohort}기`, member.soon && `${member.soon}순`].filter(Boolean).join(' · ');
        return `<article class="topic"><small>${esc(member.name || '이름 없는 기도자')}${metadata ? ` · ${esc(metadata)}` : ''} · ${esc(date)}</small>${esc(item.content)}${response}</article>`;
      }).join('')}</section>`
    ).join('');
    return `<section class="admin-group"><h4>${esc(group)} <span>${count}개</span></h4>${roomMarkup}</section>`;
  }).join('');
}

function renderAdminPrayerHistory() {
  const historyEl = $('#adminPrayerHistory');
  if (!historyEl) return;
  historyEl.innerHTML = adminPrayerHistory.length ? adminPrayerHistory.map((item) => {
    const date = new Date(item.created_at).toLocaleString('ko-KR');
    const editing = editingSharedPrayerTopicId === item.id;
    const content = editing
      ? `<input class="field" id="sharedTopicTitleEdit-${item.id}" maxlength="120" value="${esc(item.title || '')}" placeholder="기도제목 이름"><textarea class="field" id="sharedTopicEdit-${item.id}" maxlength="2000" placeholder="내용">${esc(item.content)}</textarea><div class="topic-actions"><button class="response-button" onclick="saveSharedPrayerTopic('${item.id}')">저장</button><button class="response-button" onclick="cancelSharedPrayerTopicEdit()">취소</button></div>`
      : `${item.title ? `<h4 class="shared-topic-title">${esc(item.title)}</h4>` : ''}${esc(item.content)}<div class="topic-actions"><button class="response-button" onclick="editSharedPrayerTopic('${item.id}')">수정</button><button class="response-button" onclick="deleteSharedPrayerTopic('${item.id}')">삭제</button></div>`;
    return `<article class="topic"><small>${esc(date)}</small>${content}</article>`;
  }).join('') : '<div class="empty">아직 게시된 공통 기도제목이 없어요.</div>';
}

window.editSharedPrayerTopic = (id) => {
  if (profile?.role !== 'admin') return toast('관리자 계정으로 로그인해 주세요.');
  editingSharedPrayerTopicId = id;
  renderAdminPrayerHistory();
};

window.cancelSharedPrayerTopicEdit = () => {
  editingSharedPrayerTopicId = null;
  renderAdminPrayerHistory();
};

window.saveSharedPrayerTopic = async (id) => {
  if (profile?.role !== 'admin') return toast('관리자 계정으로 로그인해 주세요.');
  const item = adminPrayerHistory.find((entry) => entry.id === id);
  const input = document.getElementById(`sharedTopicEdit-${id}`);
  const titleInput = document.getElementById(`sharedTopicTitleEdit-${id}`);
  const content = input?.value.trim();
  if (!item || !content) return toast('공통 기도제목을 입력해 주세요.');
  const { error } = await supabase.from('room_prayer_topics').update({ title: titleInput?.value.trim() || '', content }).eq('id', id);
  if (error) return toast(error.message);
  editingSharedPrayerTopicId = null;
  await loadRoom();
  await loadAdminData();
  toast('공통 기도제목을 수정했어요.');
};

window.deleteSharedPrayerTopic = async (id) => {
  if (profile?.role !== 'admin') return toast('관리자 계정으로 로그인해 주세요.');
  const item = adminPrayerHistory.find((entry) => entry.id === id);
  if (!item || !window.confirm('이 공통 기도제목 기록을 삭제할까요?')) return;
  const { error } = await supabase.from('room_prayer_topics').delete().eq('id', id);
  if (error) return toast(error.message);
  await loadRoom();
  if (editingSharedPrayerTopicId === id) editingSharedPrayerTopicId = null;
  await loadAdminData();
  toast('공통 기도제목을 삭제했어요.');
};

async function saveYouTubeLink() {
  if (profile?.role !== 'admin') return toast('관리자 계정으로 로그인해 주세요.');
  const input = $('#youtubeUrl').value.trim();
  const videoId = youtubeVideoId(input);
  if (!videoId) return toast('개별 YouTube 영상 링크를 확인해 주세요.');
  const { error } = await supabase.from('room_settings').update({
    youtube_url: input,
    audio_url: null,
    audio_name: null,
    updated_at: new Date().toISOString()
  }).eq('id', 1);
  if (error) return toast(error.message);
  $('#uploadStatus').textContent = 'YouTube 영상이 배경음악으로 설정됐어요.';
  await loadRoom();
  toast('YouTube 배경음악을 저장했어요.');
}

async function uploadAudio(event) {
  if (profile?.role !== 'admin') return toast('관리자 계정으로 로그인해 주세요.');
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 40 * 1024 * 1024) return toast('음원은 40MB 이하 파일로 선택해 주세요.');
  $('#uploadStatus').textContent = '업로드 중…';
  const path = `room/${Date.now()}-${file.name.replace(/[^\w.가-힣-]/g, '_')}`;
  const { error } = await supabase.storage.from('room-audio').upload(path, file, { upsert: true, contentType: file.type });
  if (error) { $('#uploadStatus').textContent = error.message; return toast(error.message); }
  const { data: { publicUrl } } = supabase.storage.from('room-audio').getPublicUrl(path);
  const { error: settingsError } = await supabase.from('room_settings').update({ audio_url: publicUrl, audio_name: file.name, youtube_url: null }).eq('id', 1);
  if (settingsError) return toast(settingsError.message);
  $('#uploadStatus').textContent = `업로드 완료: ${file.name}`;
  await loadRoom();
  toast('배경음악을 업데이트했어요.');
}

$$('.nav [data-page]').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.page === 'admin') {
    if (!user) { adminLoginPending = true; window.openAuth('login'); return; }
    if (profile?.role !== 'admin') return toast('관리자 계정만 들어갈 수 있어요.');
    return page('admin');
  }
  if (button.dataset.page === 'mypage') {
    if (!user) { page('mypage'); return; }
    $('#reauthModal').classList.add('open');
    $('#reauthPassword').focus();
    return;
  }
  page(button.dataset.page);
}));
$$('[data-auth-tab]').forEach((button) => button.addEventListener('click', () => authTab(button.dataset.authTab)));
$('#goRoom').addEventListener('click', () => page('room'));
$('#authButton').addEventListener('click', () => window.openAuth('login'));
$('#logoutButton').addEventListener('click', async () => {
  if (activeSessionId) await stopPrayer();
  stopRoomPresence();
  await supabase.auth.signOut();
  user = null; profile = null; await init(); page('home'); toast('로그아웃했어요.');
});
$('#closeModal').addEventListener('click', () => $('#authModal').classList.remove('open'));
$('#authModal').addEventListener('click', (event) => { if (event.target === $('#authModal')) $('#authModal').classList.remove('open'); });
$('#verifyEmailBtn').addEventListener('click', sendVerificationEmail);
$('#signupForm').addEventListener('submit', completeSignup);
$('#signupForm [name="email"]').addEventListener('input', refreshSignupGate);
$('#loginForm').addEventListener('submit', login);
$('#reauthForm').addEventListener('submit', reauthenticate);
$('#closeReauth').addEventListener('click', () => $('#reauthModal').classList.remove('open'));
$('#profileForm').addEventListener('submit', saveProfile);
$('#requestEmailChange').addEventListener('click', requestEmailChange);
$('#confirmEmailChange').addEventListener('click', confirmEmailChange);
$('#saveTopic').addEventListener('click', saveTopic);
$('#startBtn').addEventListener('click', beginPrayer);
$('#stopBtn').addEventListener('click', stopPrayer);
$('#saveAdminTopic').addEventListener('click', saveAdminTopic);
$('#addSharedTopicDraft').addEventListener('click', appendSharedTopicDraft);
$('#sharedTopicDrafts').addEventListener('click', (event) => {
  if (!event.target.closest('.remove-shared-draft')) return;
  const rows = $$('#sharedTopicDrafts .shared-topic-entry');
  if (rows.length <= 1) {
    rows[0]?.querySelectorAll('input,textarea').forEach((input) => { input.value = ''; });
    return;
  }
  event.target.closest('.shared-topic-entry').remove();
});
$('#resetAllPrayerTime').addEventListener('click', () => window.resetAllPrayerTime());
$('#saveYoutubeLink').addEventListener('click', saveYouTubeLink);
$('#audioFile').addEventListener('change', uploadAudio);
$$('input[type="tel"]').forEach((input) => input.addEventListener('input', () => { input.value = phoneFormat(input.value); }));
$('#loginForm [name="identifier"]').addEventListener('input', (event) => {
  if (!event.target.value.includes('@')) event.target.value = phoneFormat(event.target.value);
});
window.addEventListener('focus', () => {
  if ($('#room').classList.contains('active')) {
    refreshPresence();
    startRoomPresence();
  }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && $('#room').classList.contains('active')) {
    refreshPresence();
    startRoomPresence();
  }
});
supabase?.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_OUT') setTimeout(init, 0);
});

try {
  ({ createClient } = await import('https://esm.sh/@supabase/supabase-js@2'));
  const response = await fetch('/.netlify/functions/config');
  const config = response.ok ? await response.json() : null;
  if (config?.url && config?.anonKey) {
    supabase = createClient(config.url, config.anonKey);
    configured = true;
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_OUT') setTimeout(init, 0);
    });
  }
} catch (error) {
  console.error('Prayer room startup failed:', error);
  toast('사이트 기능을 불러오지 못했어요. 인터넷 연결과 배포 파일을 확인해 주세요.');
}
if (supabase) await init();
else console.warn('Supabase config function did not return a URL and anon key.');
appendSharedTopicDraft();
