// ============================================================
// 전역 상태
// ============================================================
var map, clusterer;
var allProperties = [], allCustomers = [], allLocations = [];
var markers = [];
var selectedId = null;
var currentTab = 'property';
var authEmail = '';

var KAKAO_JS_KEY = window.__KAKAO_JS_KEY;
var API_URL      = window.__GAS_API_URL;

// ============================================================
// 인증
// ============================================================
document.getElementById('authBtn').addEventListener('click', tryAuth);
document.getElementById('authEmail').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') tryAuth();
});

function tryAuth() {
  var email = document.getElementById('authEmail').value.trim().toLowerCase();
  var msgEl = document.getElementById('authMsg');
  var btn   = document.getElementById('authBtn');

  if (!email || email.indexOf('@') === -1) {
    msgEl.textContent = '올바른 이메일을 입력하세요';
    return;
  }

  msgEl.textContent = '';
  btn.disabled = true;
  btn.textContent = '확인 중...';

  // 서버에 인증 요청
  fetch(API_URL + '?action=ping&email=' + encodeURIComponent(email))
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (res.error === 'unauthorized') {
        msgEl.textContent = '⛔ 등록되지 않은 이메일입니다';
        btn.disabled = false;
        btn.textContent = '접속';
        return;
      }
      if (res.error) {
        msgEl.textContent = '오류: ' + res.error;
        btn.disabled = false;
        btn.textContent = '접속';
        return;
      }
      // 성공
      authEmail = email;
      localStorage.setItem('authEmail', email);
      startApp();
    })
    .catch(function(err) {
      msgEl.textContent = '네트워크 오류: ' + err.message;
      btn.disabled = false;
      btn.textContent = '접속';
    });
}

// 자동 로그인
(function() {
  var saved = localStorage.getItem('authEmail');
  if (saved) {
    authEmail = saved;
    // 저장된 이메일 유효성 재확인
    fetch(API_URL + '?action=ping&email=' + encodeURIComponent(saved))
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (!res.error) startApp();
        else localStorage.removeItem('authEmail');
      })
      .catch(function() { /* 네트워크 오류 시 로그인 화면 유지 */ });
  }
})();

document.getElementById('logoutBtn').addEventListener('click', function() {
  localStorage.removeItem('authEmail');
  location.reload();
});

// ============================================================
// 카카오맵 SDK 로드
// ============================================================
function loadKakaoSDK() {
  return new Promise(function(resolve, reject) {
    if (window.kakao && kakao.maps) return resolve();
    var s = document.createElement('script');
    s.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + KAKAO_JS_KEY
          + '&libraries=clusterer&autoload=false';
    s.async = true;
    s.onload = function() {
      if (typeof kakao === 'undefined' || !kakao.maps) return reject('kakao 객체 없음');
      kakao.maps.load(resolve);
    };
    s.onerror = function() { reject('카카오 SDK 로드 실패'); };
    document.head.appendChild(s);
  });
}

// ============================================================
// 앱 시작
// ============================================================
function startApp() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  showLoading(true, '데이터 로드 중...');

  Promise.all([loadKakaoSDK(), fetchAllData()])
    .then(function() {
      initMap();
      bindTabs();
      bindFilters();
      renderList();
      renderMarkers();
      showLoading(false);
    })
    .catch(function(err) {
      showLoading(false);
      alert('초기화 실패: ' + err);
      console.error(err);
    });
}

// ============================================================
// 데이터 로드
// ============================================================
function fetchAllData() {
  var url = API_URL + '?action=getAll&email=' + encodeURIComponent(authEmail);
  return fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) throw new Error(data.error);
      allProperties = data.properties || [];
      allCustomers  = data.customers  || [];
      allLocations  = data.locations  || [];
    });
}

// ============================================================
// 지도 초기화
// ============================================================
function initMap() {
  map = new kakao.maps.Map(document.getElementById('map'), {
    center: new kakao.maps.LatLng(33.4996, 126.5312),
    level: 10
  });
  clusterer = new kakao.maps.MarkerClusterer({
    map: map,
    averageCenter: true,
    minLevel: 6,
    styles: [{
      width: '44px', height: '44px',
      background: 'rgba(74,144,226,0.85)',
      borderRadius: '50%', color: '#fff',
      textAlign: 'center', lineHeight: '44px',
      fontSize: '13px', fontWeight: 'bold'
    }]
  });
}

// ============================================================
// 탭 전환
// ============================================================
function bindTabs() {
  var tabs = document.querySelectorAll('.tab');
  tabs.forEach(function(t) {
    t.addEventListener('click', function() {
      tabs.forEach(function(x) { x.classList.remove('active'); });
      t.classList.add('active');
      currentTab = t.dataset.tab;
      document.getElementById('filterProperty').classList.toggle('hidden', currentTab !== 'property');
      document.getElementById('filterCustomer').classList.toggle('hidden', currentTab !== 'customer');
      renderList();
      renderMarkers();
    });
  });
}

// ============================================================
// 필터 바인딩
// ============================================================
function bindFilters() {
  ['filterType','filterTrade'].forEach(function(id) {
    document.getElementById(id).addEventListener('change', function() {
      renderList(); renderMarkers();
    });
  });
  document.getElementById('searchInput').addEventListener('input', debounce(function() {
    renderList(); renderMarkers();
  }, 250));
  document.getElementById('searchCustomer').addEventListener('input', debounce(function() {
    renderList();
  }, 250));
}

// ============================================================
// 리스트 렌더
// ============================================================
function renderList() {
  var container = document.getElementById('listContainer');
  if (currentTab === 'property') renderPropertyList(container);
  else renderCustomerList(container);
}

function renderPropertyList(container) {
  var filtered = getFilteredProperties();
  document.getElementById('filteredCount').textContent = filtered.length;
  document.getElementById('totalCount').textContent = allProperties.length;
  document.getElementById('totalBadge').textContent = allProperties.length;

  if (!filtered.length) {
    container.innerHTML = '<div class="empty">조건에 맞는 매물이 없습니다.</div>';
    return;
  }

  var html = '';
  filtered.forEach(function(p) {
    var metaParts = [];
    if (p.전용) metaParts.push('전용 ' + p.전용);
    if (p.방)   metaParts.push(p.방 + '방');
    if (p.욕실) metaParts.push(p.욕실 + '욕실');

    html += '<div class="listing-card ' + (selectedId === p.매물ID ? 'active' : '') + '" data-id="' + escapeHtml(p.매물ID) + '">';
    html += '<span class="type-tag" style="background:' + p.색상 + '">' + escapeHtml(p.매물유형 || '기타') + '</span>';
    if (p.매물상태) html += '<span class="status">' + escapeHtml(p.매물상태) + '</span>';
    html += '<div class="title">' + escapeHtml(p.매물명 || '이름없음') + '</div>';
    html += '<div class="address">' + escapeHtml(p.지번주소 || p.소재지 || '') + '</div>';
    html += '<div class="price">' + formatPrice(p) + '</div>';
    if (metaParts.length) html += '<div class="meta">' + metaParts.join(' / ') + '</div>';
    html += '</div>';
  });
  container.innerHTML = html;

  container.querySelectorAll('.listing-card').forEach(function(el) {
    el.addEventListener('click', function() { focusProperty(el.dataset.id); });
  });
}

function renderCustomerList(container) {
  var keyword = document.getElementById('searchCustomer').value.trim().toLowerCase();
  var filtered = allCustomers.filter(function(c) {
    if (!keyword) return true;
    var hay = ((c.고객명||'') + ' ' + (c.연락처||'') + ' ' + (c.이메일||'')).toLowerCase();
    return hay.indexOf(keyword) !== -1;
  });
  document.getElementById('totalCustomer').textContent = allCustomers.length;

  if (!filtered.length) {
    container.innerHTML = '<div class="empty">고객이 없습니다.</div>';
    return;
  }

  var html = '';
  filtered.forEach(function(c) {
    html += '<div class="customer-card">';
    if (c.등급) html += '<span class="grade">' + escapeHtml(c.등급) + '</span>';
    html += '<div class="name">' + escapeHtml(c.고객명 || '이름없음') + '</div>';
    html += '<div class="contact">' + escapeHtml(c.연락처 || '') + '</div>';
    var info = [];
    if (c.관심유형) info.push('관심: ' + c.관심유형);
    if (c.관심지역) info.push('지역: ' + c.관심지역);
    if (c.예산)    info.push('예산: ' + c.예산);
    if (info.length) html += '<div class="info">' + escapeHtml(info.join(' · ')) + '</div>';
    html += '</div>';
  });
  container.innerHTML = html;
}

// ============================================================
// 매물 필터
// ============================================================
function getFilteredProperties() {
  var type = document.getElementById('filterType').value;
  var trade = document.getElementById('filterTrade').value;
  var keyword = document.getElementById('searchInput').value.trim().toLowerCase();

  return allProperties.filter(function(p) {
    if (type && p.매물유형 !== type) return false;
    if (trade && p.거래유형 !== trade) return false;
    if (keyword) {
      var hay = ((p.매물명||'') + ' ' + (p.지번주소||'') + ' ' + (p.소재지||'')).toLowerCase();
      if (hay.indexOf(keyword) === -1) return false;
    }
    return true;
  });
}

// ============================================================
// 마커 렌더
// ============================================================
function renderMarkers() {
  if (!clusterer) return;
  clusterer.clear();
  markers.forEach(function(m) {
    m.setMap(null);
    if (m._overlay) m._overlay.setMap(null);
  });
  markers = [];

  if (currentTab !== 'property') return;

  var filtered = getFilteredProperties();
  filtered.forEach(function(p) {
    if (!p.lat || !p.lng) return;
    var pos = new kakao.maps.LatLng(p.lat, p.lng);
    var marker = new kakao.maps.Marker({ position: pos, title: p.매물명 });

    var content = '<div style="background:' + p.색상 + ';color:#fff;padding:4px 8px;'
      + 'border-radius:12px;font-size:11px;font-weight:bold;white-space:nowrap;'
      + 'box-shadow:0 2px 6px rgba(0,0,0,.25);border:2px solid #fff;cursor:pointer;">'
      + formatPriceShort(p) + '</div>';

    var overlay = new kakao.maps.CustomOverlay({
      position: pos, content: content, yAnchor: 1.4
    });

    kakao.maps.event.addListener(marker, 'click', function() {
      focusProperty(p.매물ID);
    });

    marker._overlay = overlay;
    marker._propertyId = p.매물ID;
    markers.push(marker);
  });

  clusterer.addMarkers(markers);
  markers.forEach(function(m) { m._overlay.setMap(map); });
}

// ============================================================
// 매물 선택
// ============================================================
function focusProperty(id) {
  selectedId = id;
  document.querySelectorAll('.listing-card').forEach(function(c) {
    c.classList.toggle('active', c.dataset.id === id);
  });

  var m = markers.find(function(x) { return x._propertyId === id; });
  if (m && map) {
    map.panTo(m.getPosition());
    if (map.getLevel() > 5) map.setLevel(4);
  }

  // 모바일: 리스트 상단으로 스크롤
  if (window.innerWidth <= 768) {
    document.getElementById('listContainer').scrollTop = 0;
  }
}

// ============================================================
// 가격 포맷
// ============================================================
function formatPrice(p) {
  var t = p.거래유형 || '';
  if (t === '매매') return p.매매가 ? Number(p.매매가).toLocaleString() + '만원' : '가격문의';
  if (t === '전세') return p.보증금 ? '전세 ' + Number(p.보증금).toLocaleString() + '만원' : '가격문의';
  if (t === '월세') {
    var b = p.보증금 ? Number(p.보증금).toLocaleString() : '0';
    var m = p.월세 ? Number(p.월세).toLocaleString() : '0';
    return b + ' / ' + m + '만원';
  }
  if (p.매매가) return Number(p.매매가).toLocaleString() + '만원';
  return '가격문의';
}

function formatPriceShort(p) {
  var t = p.거래유형 || '';
  if (t === '매매' && p.매매가) {
    var v = Number(p.매매가);
    return v >= 10000 ? (v/10000).toFixed(1) + '억' : v.toLocaleString();
  }
  if (t === '전세' && p.보증금) {
    var v2 = Number(p.보증금);
    return v2 >= 10000 ? '전' + (v2/10000).toFixed(1) + '억' : '전' + v2.toLocaleString();
  }
  if (t === '월세' && p.월세) {
    return (p.보증금 ? Number(p.보증금)/1000 + '/' : '') + Number(p.월세).toLocaleString();
  }
  return '문의';
}

// ============================================================
// 유틸
// ============================================================
function showLoading(show, msg) {
  var el = document.getElementById('loading');
  if (!el) return;
  if (msg) document.getElementById('loadingMsg').textContent = msg;
  el.classList.toggle('hidden', !show);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function debounce(fn, ms) {
  var t;
  return function() { clearTimeout(t); t = setTimeout(fn, ms); };
}