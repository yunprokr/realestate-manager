// ============================================================
// 전역
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
// 매물유형 → 상세 목록
// ============================================================
var TYPE_DETAIL_MAP = {
  '토지':     ['전', '답', '과수원', '임야', '대지', '잡종지', '목장용지'],
  '상가':     ['일반상가', '사무실', '상가건물(통매)', '숙박시설(펜션/모텔)', '근생', '빌딩'],
  '공장창고': ['공장', '창고', '야적장', '지식산업센터'],
  '주택':     ['원룸', '2룸', '3룸', '단독', '단독다가구', '구옥', '전원농가',
               '타운하우스', '아파트', '빌라', '연립', '다세대', '오피스텔',
               '생활형숙박시설']
};

// ============================================================
// 인증
// ============================================================
document.getElementById('authBtn').addEventListener('click', tryAuth);
document.getElementById('authEmail').addEventListener('keydown', e => {
  if (e.key === 'Enter') tryAuth();
});

function tryAuth() {
  var email = document.getElementById('authEmail').value.trim().toLowerCase();
  var msgEl = document.getElementById('authMsg');
  var btn = document.getElementById('authBtn');

  if (!email || email.indexOf('@') === -1) {
    msgEl.textContent = '올바른 이메일을 입력하세요';
    return;
  }
  msgEl.textContent = '';
  btn.disabled = true;
  btn.textContent = '확인 중...';

  fetch(API_URL + '?action=ping&email=' + encodeURIComponent(email))
    .then(r => r.json())
    .then(res => {
      if (res.error === 'unauthorized') {
        msgEl.textContent = '⛔ 등록되지 않은 이메일입니다';
        btn.disabled = false; btn.textContent = '접속';
        return;
      }
      if (res.error) {
        msgEl.textContent = '오류: ' + res.error;
        btn.disabled = false; btn.textContent = '접속';
        return;
      }
      authEmail = email;
      localStorage.setItem('authEmail', email);
      startApp();
    })
    .catch(err => {
      msgEl.textContent = '네트워크 오류: ' + err.message;
      btn.disabled = false; btn.textContent = '접속';
    });
}

(function() {
  var saved = localStorage.getItem('authEmail');
  if (saved) {
    authEmail = saved;
    fetch(API_URL + '?action=ping&email=' + encodeURIComponent(saved))
      .then(r => r.json())
      .then(res => { if (!res.error) startApp(); else localStorage.removeItem('authEmail'); })
      .catch(() => {});
  }
})();

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('authEmail');
  location.reload();
});

// ============================================================
// 카카오 SDK
// ============================================================
function loadKakaoSDK() {
  return new Promise((resolve, reject) => {
    if (window.kakao && kakao.maps) return resolve();
    var s = document.createElement('script');
    s.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + KAKAO_JS_KEY
          + '&libraries=clusterer&autoload=false';
    s.async = true;
    s.onload = () => {
      if (typeof kakao === 'undefined' || !kakao.maps) return reject('kakao 객체 없음');
      kakao.maps.load(resolve);
    };
    s.onerror = () => reject('카카오 SDK 로드 실패');
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
    .then(() => {
      initMap();
      bindTabs();
      bindFilters();
      bindDetailClose();
      renderList();
      renderMarkers();
      showLoading(false);
    })
    .catch(err => {
      showLoading(false);
      alert('초기화 실패: ' + err);
      console.error(err);
    });
}

function fetchAllData() {
  var url = API_URL + '?action=getAll&email=' + encodeURIComponent(authEmail);
  return fetch(url)
    .then(r => r.json())
    .then(data => {
      if (data.error) throw new Error(data.error);
      allProperties = data.properties || [];
      allCustomers  = data.customers  || [];
      allLocations  = data.locations  || [];
    });
}

// ============================================================
// 지도
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
// 탭
// ============================================================
function bindTabs() {
  var tabs = document.querySelectorAll('.tab');
  tabs.forEach(t => {
    t.addEventListener('click', () => {
      tabs.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      currentTab = t.dataset.tab;
      document.getElementById('propertyPane').classList.toggle('hidden', currentTab !== 'property');
      document.getElementById('customerPane').classList.toggle('hidden', currentTab !== 'customer');
      if (currentTab === 'property') {
        renderList(); renderMarkers();
      }
    });
  });
}

// ============================================================
// 필터
// ============================================================
function bindFilters() {
  document.getElementById('filterType').addEventListener('change', () => {
    updateTypeDetailDropdown();
    renderList(); renderMarkers();
  });
  document.getElementById('filterTypeDetail').addEventListener('change', () => {
    renderList(); renderMarkers();
  });
  document.getElementById('filterTrade').addEventListener('change', () => {
    renderList(); renderMarkers();
  });
  ['priceMin', 'priceMax'].forEach(id => {
    document.getElementById(id).addEventListener('input', debounce(() => {
      renderList(); renderMarkers();
    }, 300));
  });
  document.getElementById('searchInput').addEventListener('input', debounce(() => {
    renderList(); renderMarkers();
  }, 250));
}

// 매물유형 변경 시 상세 드롭다운 갱신
function updateTypeDetailDropdown() {
  var type = document.getElementById('filterType').value;
  var detailSel = document.getElementById('filterTypeDetail');
  var curVal = detailSel.value;

  detailSel.innerHTML = '<option value="">전체 상세</option>';

  if (type && TYPE_DETAIL_MAP[type]) {
    TYPE_DETAIL_MAP[type].forEach(d => {
      var opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      if (d === curVal) opt.selected = true;
      detailSel.appendChild(opt);
    });
  }
}

// ============================================================
// 필터링
// ============================================================
function getFilteredProperties() {
  var type = document.getElementById('filterType').value;
  var typeDetail = document.getElementById('filterTypeDetail').value;
  var trade = document.getElementById('filterTrade').value;
  var minP = parseFloat(document.getElementById('priceMin').value) || 0;
  var maxP = parseFloat(document.getElementById('priceMax').value) || Infinity;
  var keyword = document.getElementById('searchInput').value.trim().toLowerCase();

  return allProperties.filter(p => {
    if (type && p.매물유형 !== type) return false;
    if (typeDetail && p.매물유형상세 !== typeDetail) return false;
    if (trade && p.거래유형 !== trade) return false;

    if (minP > 0 || maxP < Infinity) {
      var price = getRepresentativePrice(p);
      if (price !== null) {
        if (price < minP || price > maxP) return false;
      }
    }

    if (keyword) {
      var hay = ((p.매물명 || '') + ' ' + (p.지번주소 || '') + ' ' + (p.소재지 || '') + ' ' + (p.고객명 || '')).toLowerCase();
      if (hay.indexOf(keyword) === -1) return false;
    }
    return true;
  });
}

function getRepresentativePrice(p) {
  var t = p.거래유형 || '';
  if (t === '매매') return Number(p.매매가) || null;
  if (t === '전세') return Number(p.보증금) || null;
  if (t === '연세') return Number(p.연세) || null;
  if (t === '월세') return Number(p.월세) || null;
  if (t === '단기') return Number(p.월세) || null;
  return null;
}

// ============================================================
// 리스트 렌더
// ============================================================
function renderList() {
  var container = document.getElementById('listContainer');
  var filtered = getFilteredProperties();

  document.getElementById('filteredCount').textContent = filtered.length;
  document.getElementById('totalCount').textContent = allProperties.length;
  document.getElementById('totalBadge').textContent = allProperties.length;

  if (!filtered.length) {
    container.innerHTML = '<div class="empty">조건에 맞는 매물이 없습니다.</div>';
    return;
  }

  filtered.sort((a, b) => {
    var da = a.확인일 || a.등록일 || '';
    var db = b.확인일 || b.등록일 || '';
    return db.localeCompare(da);
  });

  var html = '';
  filtered.forEach(p => {
    var ownerName = getOwnerName(p.고객ID);
    var priceText = formatPrice(p);

    html += '<div class="listing-card ' + (selectedId === p.매물ID ? 'active' : '') + '" data-id="' + escapeHtml(p.매물ID) + '">';
    html += '  <div class="row-1">';
    html += '    <span class="type-tag" style="background:' + p.색상 + '">' + escapeHtml(p.매물유형 || '기타') + '</span>';
    if (p.매물유형상세) html += '    <span class="type-detail-tag">' + escapeHtml(p.매물유형상세) + '</span>';
    if (p.매물상태) html += '<span class="status-tag">' + escapeHtml(p.매물상태) + '</span>';
    html += '  </div>';
    html += '  <div class="title">' + escapeHtml(p.매물명 || '이름없음') + '</div>';
    html += '  <div class="price-row">';
    html += '    <span class="trade">' + escapeHtml(p.거래유형 || '') + '</span>';
    html += '    <span class="price">' + priceText + '</span>';
    html += '  </div>';
    html += '  <div class="address">' + escapeHtml(p.지번주소 || p.소재지 || '') + '</div>';
    html += '  <div class="footer">';
    html += '    <span class="owner">👤 ' + escapeHtml(ownerName) + '</span>';
    if (p.블로그링크) {
      html += '    <a class="blog-btn" href="' + escapeHtml(p.블로그링크) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">📝 블로그</a>';
    }
    html += '  </div>';
    html += '</div>';
  });
  container.innerHTML = html;

  container.querySelectorAll('.listing-card').forEach(el => {
    el.addEventListener('click', () => focusProperty(el.dataset.id));
  });
}

function getOwnerName(customerId) {
  if (!customerId) return '';
  var c = allCustomers.find(x => String(x.고객ID) === String(customerId));
  return c ? (c.고객명 || '') : '';
}

// ============================================================
// 마커
// ============================================================
function renderMarkers() {
  if (!clusterer) return;
  clusterer.clear();
  markers.forEach(m => {
    m.setMap(null);
    if (m._overlay) m._overlay.setMap(null);
  });
  markers = [];

  var filtered = getFilteredProperties();
  filtered.forEach(p => {
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

    kakao.maps.event.addListener(marker, 'click', () => focusProperty(p.매물ID));

    marker._overlay = overlay;
    marker._propertyId = p.매물ID;
    markers.push(marker);
  });

  clusterer.addMarkers(markers);
  markers.forEach(m => m._overlay.setMap(map));
}

// ============================================================
// 매물 선택
// ============================================================
function focusProperty(id) {
  selectedId = id;
  document.querySelectorAll('.listing-card').forEach(c => {
    c.classList.toggle('active', c.dataset.id === id);
  });

  var p = allProperties.find(x => x.매물ID === id);
  if (!p) return;

  var m = markers.find(x => x._propertyId === id);
  if (m && map) {
    map.panTo(m.getPosition());
    if (map.getLevel() > 5) map.setLevel(4);
  }

  var isMobile = window.innerWidth <= 1023;
  if (isMobile) showBottomSheet(p);
  else showDetailPanel(p);

  if (window.innerWidth <= 768) {
    document.getElementById('listContainer').scrollTop = 0;
  }
}

function showDetailPanel(p) {
  var panel = document.getElementById('detailPanel');
  document.getElementById('detailContent').innerHTML = buildDetailHTML(p);
  panel.classList.remove('hidden');
}
function showBottomSheet(p) {
  var bs = document.getElementById('bottomSheet');
  document.getElementById('bottomSheetContent').innerHTML = buildDetailHTML(p);
  bs.classList.remove('hidden');
}

function bindDetailClose() {
  document.getElementById('detailClosePC').addEventListener('click', () => {
    document.getElementById('detailPanel').classList.add('hidden');
  });
  document.getElementById('detailCloseMobile').addEventListener('click', () => {
    document.getElementById('bottomSheet').classList.add('hidden');
  });
}

// ============================================================
// 상세 HTML
// ============================================================
function buildDetailHTML(p) {
  var ownerName = getOwnerName(p.고객ID);
  var h = '';

  h += '<div class="detail-header">';
  h += '  <div class="detail-type-row">';
  h += '    <span class="type-tag" style="background:' + p.색상 + '">' + escapeHtml(p.매물유형 || '기타') + '</span>';
  if (p.매물유형상세) h += '    <span class="type-detail-tag">' + escapeHtml(p.매물유형상세) + '</span>';
  if (p.매물상태) h += '<span class="status-tag">' + escapeHtml(p.매물상태) + '</span>';
  h += '  </div>';
  h += '  <div class="detail-title">' + escapeHtml(p.매물명 || '이름없음') + '</div>';
  h += '  <div class="detail-price">' + formatPrice(p) + '</div>';
  h += '  <div class="detail-address">📍 ' + escapeHtml(p.지번주소 || p.소재지 || '') + '</div>';
  if (p.추가필지) h += '  <div class="detail-address">➕ 추가필지: ' + escapeHtml(p.추가필지) + '</div>';
  if (ownerName) h += '  <div class="detail-owner">👤 소유주: ' + escapeHtml(ownerName) + '</div>';
  h += '</div>';

  h += buildTypeSpecificHTML(p);

  if (p.내용) {
    h += '<div class="detail-section">';
    h += '  <h4>메모</h4>';
    h += '  <div style="font-size:13px; color:#444; line-height:1.6; white-space:pre-wrap;">' + escapeHtml(p.내용) + '</div>';
    h += '</div>';
  }

  h += '<div class="detail-section">';
  h += '  <h4>등록 정보</h4>';
  if (p.등록일) h += detailRow('등록일', p.등록일);
  if (p.확인일) h += detailRow('확인일', p.확인일);
  if (p.고객ID) h += detailRow('고객ID', p.고객ID);
  h += '</div>';

  if (p.블로그링크) {
    h += '<div class="detail-actions">';
    h += '  <a class="btn-blog" href="' + escapeHtml(p.블로그링크) + '" target="_blank" rel="noopener">📝 블로그에서 보기</a>';
    h += '</div>';
  }

  return h;
}

function buildTypeSpecificHTML(p) {
  var t = p.매물유형;
  var h = '';

  // 금액
  h += '<div class="detail-section"><h4>금액</h4>';
  if (p.매매가) h += detailRow('매매가', formatMan(p.매매가));
  if (p.보증금) h += detailRow('보증금', formatMan(p.보증금));
  if (p.연세) h += detailRow('연세', formatMan(p.연세));
  if (p.월세) h += detailRow('월세', formatMan(p.월세));
  if (p.관리비) h += detailRow('관리비', formatMan(p.관리비));
  if (p.관리비포함항목) h += detailRow('관리비 포함', p.관리비포함항목);
  if (p.권리금) h += detailRow('권리금', formatMan(p.권리금));
  if (p.평단가) h += detailRow('평단가', formatMan(p.평단가) + '/평');
  h += '</div>';

  // 면적
  var hasArea = p.대지 || p.공급 || p.전용 || p.연면적;
  if (hasArea) {
    h += '<div class="detail-section"><h4>면적</h4>';
    if (p.대지) h += detailRow('대지', p.대지 + ' ㎡');
    if (p.공급) h += detailRow('공급', p.공급 + ' ㎡');
    if (p.전용) h += detailRow('전용', p.전용 + ' ㎡');
    if (p.연면적) h += detailRow('연면적', p.연면적 + ' ㎡');
    h += '</div>';
  }

  // 토지
  if (t === '토지') {
    h += '<div class="detail-section"><h4>토지 정보</h4>';
    if (p.매물유형상세) h += detailRow('지목', p.매물유형상세);
    if (p.용도지역) h += detailRow('용도지역', p.용도지역);
    if (p.지구구역) h += detailRow('지구.구역', p.지구구역);
    h += '</div>';
  }

  // 상가
  if (t === '상가') {
    h += '<div class="detail-section"><h4>상가 정보</h4>';
    if (p.해당층총층) h += detailRow('층', p.해당층총층);
    if (p.현업종) h += detailRow('현업종', p.현업종);
    if (p.추천업종) h += detailRow('추천업종', p.추천업종);
    if (p.임대현황) h += detailRow('임대현황', p.임대현황);
    h += '</div>';
  }

  // 공장창고
  if (t === '공장창고') {
    h += '<div class="detail-section"><h4>공장/창고 정보</h4>';
    if (p.사용전력) h += detailRow('사용전력', p.사용전력 + ' kW');
    if (p.층고) h += detailRow('층고', p.층고 + ' m');
    if (p.용도지역) h += detailRow('용도지역', p.용도지역);
    h += '</div>';
  }

  // 주택 (B: 통합, 빈 값 숨김)
  if (t === '주택') {
    h += '<div class="detail-section"><h4>주택 정보</h4>';
    if (p.방) h += detailRow('방', p.방 + '개');
    if (p.욕실) h += detailRow('욕실', p.욕실 + '개');
    if (p.건축물용도) h += detailRow('건축물용도', p.건축물용도);
    if (p.건물명) h += detailRow('건물명', p.건물명);
    if (p.해당동) h += detailRow('동', p.해당동);
    if (p.호수) h += detailRow('호수', p.호수);
    if (p.해당층총층) h += detailRow('층', p.해당층총층);
    if (p.방향) h += detailRow('방향', p.방향);
    if (p.특수구조) h += detailRow('특수구조', p.특수구조);
    if (p.특수구조상세) h += detailRow('특수구조 상세', p.특수구조상세);
    if (p.반려동물) h += detailRow('반려동물', p.반려동물);
    if (p.엘리베이터) h += detailRow('엘리베이터', p.엘리베이터);
    if (p.주차) h += detailRow('주차', p.주차);
    if (p.세대수) h += detailRow('세대수', p.세대수);
    if (p.사용승인일) h += detailRow('사용승인일', p.사용승인일);
    h += '</div>';
  }

  return h;
}

function detailRow(label, value) {
  return '<div class="detail-row"><span class="label">' + escapeHtml(label) + '</span><span class="value">' + escapeHtml(value) + '</span></div>';
}

// ============================================================
// 가격 포맷
// ============================================================
function formatPrice(p) {
  var t = p.거래유형 || '';
  if (t === '매매') return p.매매가 ? Number(p.매매가).toLocaleString() + '만원' : '가격문의';
  if (t === '전세') return p.보증금 ? '전세 ' + Number(p.보증금).toLocaleString() + '만원' : '가격문의';
  if (t === '연세') return p.연세 ? '연세 ' + Number(p.연세).toLocaleString() + '만원' : '가격문의';
  if (t === '월세') {
    var b = p.보증금 ? Number(p.보증금).toLocaleString() : '0';
    var m = p.월세 ? Number(p.월세).toLocaleString() : '0';
    return b + ' / ' + m + '만원';
  }
  if (t === '단기') {
    var b2 = p.보증금 ? Number(p.보증금).toLocaleString() : '0';
    var m2 = p.월세 ? Number(p.월세).toLocaleString() : '0';
    return '단기 ' + b2 + ' / ' + m2 + '만원';
  }
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
  if (t === '연세' && p.연세) return '연' + Number(p.연세).toLocaleString();
  if ((t === '월세' || t === '단기') && p.월세) {
    return (p.보증금 ? Number(p.보증금)/1000 + '/' : '') + Number(p.월세).toLocaleString();
  }
  return '문의';
}

function formatMan(v) {
  return Number(v).toLocaleString() + '만원';
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
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function debounce(fn, ms) {
  var t;
  return function() { clearTimeout(t); t = setTimeout(fn, ms); };
}

document.getElementById('addPropertyBtn').addEventListener('click', () => {
  document.getElementById('addPropertyModal').classList.remove('hidden');
});
document.getElementById('closeAddModal').addEventListener('click', () => {
  document.getElementById('addPropertyModal').classList.add('hidden');
});
