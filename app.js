// ============================================================
// 전역
// ============================================================
var map, clusterer;
var allProperties = [], allCustomers = [], allLocations = [];
var clusterMarkers = [];       // 클러스터 모드용 기본 마커
var individualMarkers = [];    // 개별 모드용 커스텀 오버레이
var selectedId = null;
var currentTab = 'property';
var authEmail = '';

// 클러스터 임계값
var CLUSTER_LEVEL_THRESHOLD = 8;  // 8 이상이면 클러스터, 6 이하면 개별
var currentMarkerMode = null;

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

  initClusterer();

  // 줌 변경 시 마커 재렌더 (디바운스)
  kakao.maps.event.addListener(map, 'zoom_changed', debounce(function() {
    renderMarkers();
  }, 150));
}

// ============================================================
// 클러스터러 초기화
// ============================================================
function initClusterer() {
  clusterer = new kakao.maps.MarkerClusterer({
    map: map,
    averageCenter: true,
    minLevel: CLUSTER_LEVEL_THRESHOLD,
    disableClickZoom: false,
    styles: [
      {
        width: '40px', height: '40px',
        background: 'rgba(74,144,226,0.85)',
        borderRadius: '50%', color: '#fff',
        textAlign: 'center', lineHeight: '40px',
        fontSize: '12px', fontWeight: 'bold'
      },
      {
        width: '50px', height: '50px',
        background: 'rgba(74,144,226,0.9)',
        borderRadius: '50%', color: '#fff',
        textAlign: 'center', lineHeight: '50px',
        fontSize: '13px', fontWeight: 'bold'
      },
      {
        width: '60px', height: '60px',
        background: 'rgba(52,120,200,0.95)',
        borderRadius: '50%', color: '#fff',
        textAlign: 'center', lineHeight: '60px',
        fontSize: '14px', fontWeight: 'bold'
      }
    ]
  });

  // 클러스터 클릭 시 줌 인
  kakao.maps.event.addListener(clusterer, 'clusterclick', function(cluster) {
    var level = map.getLevel();
    map.setLevel(level - 2, { anchor: cluster.getCenter() });
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
// 마커 렌더 (줌 레벨별 하이브리드 + 동일 좌표 오프셋)
// ============================================================
function renderMarkers() {
  if (!map) return;

  var level = map.getLevel();
  var useCluster = level >= CLUSTER_LEVEL_THRESHOLD;

  // 기존 마커 제거
  if (clusterer) clusterer.clear();
  clusterMarkers = [];
  clearIndividualMarkers();

  var filtered = getFilteredProperties();

  if (useCluster) {
    // ===== 클러스터 모드 =====
    var markersForCluster = [];
    filtered.forEach(p => {
      if (!p.lat || !p.lng) return;
      var pos = new kakao.maps.LatLng(p.lat, p.lng);
      var marker = new kakao.maps.Marker({
        position: pos,
        title: p.매물명
      });
      marker._propertyId = p.매물ID;
      marker._property = p;
      markersForCluster.push(marker);
    });
    clusterer.addMarkers(markersForCluster);
    clusterMarkers = markersForCluster;

    markersForCluster.forEach(m => {
      kakao.maps.event.addListener(m, 'click', function() {
        focusProperty(m._propertyId);
      });
    });

  } else {
    // ===== 개별 모드 (오프셋 적용) =====
    var positioned = offsetDuplicateCoords(filtered);

    positioned.forEach(item => {
      var p = item.property;
      var pos = new kakao.maps.LatLng(item.lat, item.lng);

      var content = document.createElement('div');
      content.className = 'map-price-marker';
      content.style.background = p.색상;
      content.textContent = formatPriceShort(p);
      content.setAttribute('data-id', p.매물ID);

      // 그룹(2건 이상)이면 순번 표시
      if (item.groupSize > 1) {
        content.classList.add('grouped');
        content.textContent = formatPriceShort(p) + ' ·' + item.groupIndex;
      }

      content.addEventListener('click', (e) => {
        e.stopPropagation();
        focusProperty(p.매물ID);
      });

      var overlay = new kakao.maps.CustomOverlay({
        position: pos,
        content: content,
        yAnchor: 1.0,
        zIndex: 10
      });
      overlay.setMap(map);

      individualMarkers.push({
        _overlay: overlay,
        _propertyId: p.매물ID,
        _lat: item.lat,
        _lng: item.lng
      });
    });
  }

  currentMarkerMode = useCluster ? 'cluster' : 'individual';
}

// ============================================================
// 동일 좌표 매물 오프셋 계산
// ============================================================
function offsetDuplicateCoords(properties) {
  var coordMap = {};
  var result = [];

  // 좌표 그룹화
  properties.forEach(p => {
    if (!p.lat || !p.lng) return;
    var key = p.lat.toFixed(6) + ',' + p.lng.toFixed(6);
    if (!coordMap[key]) coordMap[key] = [];
    coordMap[key].push(p);
  });

  // 그룹별로 오프셋
  Object.keys(coordMap).forEach(key => {
    var group = coordMap[key];

    if (group.length === 1) {
      // 단독 매물: 그대로
      result.push({
        property: group[0],
        lat: group[0].lat,
        lng: group[0].lng,
        groupSize: 1,
        groupIndex: 1
      });
    } else {
      // 여러 건: 원형 배치
      var radius = 0.00012; // 약 12~15m 반경
      var count = group.length;

      group.forEach((p, i) => {
        var angle = (2 * Math.PI / count) * i - Math.PI / 2;
        var offsetLat = p.lat + (radius * Math.cos(angle));
        var offsetLng = p.lng + (radius * Math.sin(angle) / Math.cos(p.lat * Math.PI / 180));

        result.push({
          property: p,
          lat: offsetLat,
          lng: offsetLng,
          groupSize: count,
          groupIndex: i + 1
        });
      });
    }
  });

  return result;
}

// ============================================================
// 개별 마커 정리
// ============================================================
function clearIndividualMarkers() {
  individualMarkers.forEach(m => {
    if (m._overlay) m._overlay.setMap(null);
  });
  individualMarkers = [];
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

  // 상세 표시 (relayout은 여기서 처리됨)
  var isMobile = window.innerWidth <= 1023;
  if (isMobile) showBottomSheet(p);
  else showDetailPanel(p);

  // 지도 이동 (relayout 후)
  if (p.lat && p.lng) {
    // 개별 마커의 오프셋 좌표 우선
    var m = individualMarkers.find(x => x._propertyId === id);
    var lat = (m && m._lat) ? m._lat : p.lat;
    var lng = (m && m._lng) ? m._lng : p.lng;

    setTimeout(function() {
      if (!map) return;
      var pos = new kakao.maps.LatLng(lat, lng);
      map.setLevel(5, { anchor: pos });
      map.panTo(pos);
    }, 230);  // relayout(220ms) 이후
  }

  // 선택 하이라이트
  individualMarkers.forEach(mk => {
    var el = mk._overlay && mk._overlay.getContent ? mk._overlay.getContent() : null;
    if (el && el.classList) el.classList.remove('active');
  });
  var m2 = individualMarkers.find(x => x._propertyId === id);
  if (m2 && m2._overlay) {
    var el2 = m2._overlay.getContent ? m2._overlay.getContent() : null;
    if (el2 && el2.classList) el2.classList.add('active');
  }

  if (window.innerWidth <= 768) {
    document.getElementById('listContainer').scrollTop = 0;
  }
}


function showDetailPanel(p) {
  var panel = document.getElementById('detailPanel');
  var wasHidden = panel.classList.contains('hidden');

  document.getElementById('detailContent').innerHTML = buildDetailHTML(p);
  panel.classList.remove('hidden');

  // 패널이 새로 열릴 때만 relayout
  if (wasHidden) {
    setTimeout(function() {
      if (map) map.relayout();
    }, 220);
  }
}

function showBottomSheet(p) {
  var bs = document.getElementById('bottomSheet');
  var wasHidden = bs.classList.contains('hidden');

  document.getElementById('bottomSheetContent').innerHTML = buildDetailHTML(p);
  bs.classList.remove('hidden');

  if (wasHidden) {
    setTimeout(function() {
      if (map) map.relayout();
    }, 220);
  }
}


function bindDetailClose() {
  document.getElementById('detailClosePC').addEventListener('click', () => {
    document.getElementById('detailPanel').classList.add('hidden');
    setTimeout(function() {
      if (map) map.relayout();
    }, 220);
  });
  document.getElementById('detailCloseMobile').addEventListener('click', () => {
    document.getElementById('bottomSheet').classList.add('hidden');
    setTimeout(function() {
      if (map) map.relayout();
    }, 220);
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


// ============================================================
// 📝 매물 등록 모달 (PART C)
// ============================================================

// 모달 열기
document.getElementById('addPropertyBtn').addEventListener('click', openAddModal);
document.getElementById('closeAddModal').addEventListener('click', closeAddModal);
document.getElementById('btnCancelAdd').addEventListener('click', closeAddModal);

function openAddModal() {
  resetAddForm();
  document.getElementById('addPropertyModal').classList.remove('hidden');

  // 소재지 드롭다운 로드
  loadLocationOptions();

  // 오늘 날짜 표시용
  document.getElementById('geocodeStatus').textContent = '';
}

function closeAddModal() {
  document.getElementById('addPropertyModal').classList.add('hidden');
}

function resetAddForm() {
  // 모든 input, select, textarea 초기화
  var modal = document.getElementById('addPropertyModal');
  modal.querySelectorAll('input[type="text"], input[type="number"], input[type="url"], textarea').forEach(el => {
    el.value = '';
  });
  modal.querySelectorAll('input[type="checkbox"]').forEach(el => {
    el.checked = false;
  });
  modal.querySelectorAll('select').forEach(el => {
    el.selectedIndex = 0;
  });
  modal.querySelectorAll('.deal-inputs input').forEach(el => {
    el.disabled = true;
  });

  // 숨김 요소 초기화
  document.getElementById('customerSearchResults').classList.add('hidden');
  document.getElementById('selectedCustomer').classList.add('hidden');
  document.getElementById('newCustomerForm').classList.add('hidden');
  document.getElementById('f_고객ID').value = '';
  document.getElementById('f_customerSearch').value = '';

  // 상세 정보 초기화
  document.getElementById('typeSpecificFields').innerHTML =
    '<div class="empty-hint">매물유형을 선택하면 해당 필드가 나타납니다.</div>';

  // 매물유형상세 드롭다운 초기화
  document.getElementById('f_매물유형상세').innerHTML = '<option value="">선택</option>';
}

// ============================================================
// 소재지 드롭다운 로드
// ============================================================
function loadLocationOptions() {
  var sel = document.getElementById('f_소재지');
  sel.innerHTML = '<option value="">선택</option>';

  allLocations.forEach(loc => {
    var opt = document.createElement('option');
    opt.value = loc.Location;
    opt.textContent = loc.Location;
    sel.appendChild(opt);
  });
}

// ============================================================
// 매물유형 변경 시 상세 드롭다운 + 조건부 필드
// ============================================================
document.getElementById('f_매물유형').addEventListener('change', function() {
  var type = this.value;

  // 상세 드롭다운 갱신
  var detailSel = document.getElementById('f_매물유형상세');
  detailSel.innerHTML = '<option value="">선택</option>';
  if (type && TYPE_DETAIL_MAP[type]) {
    TYPE_DETAIL_MAP[type].forEach(d => {
      var opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      detailSel.appendChild(opt);
    });
  }

  // 조건부 필드 갱신
  renderTypeSpecificFields(type);
});

// ============================================================
// 매물유형별 조건부 필드 렌더링
// ============================================================
function renderTypeSpecificFields(type) {
  var container = document.getElementById('typeSpecificFields');
  container.innerHTML = '';

  if (!type) {
    container.innerHTML = '<div class="empty-hint">매물유형을 선택하면 해당 필드가 나타납니다.</div>';
    return;
  }

  var fields = [];
  var grid = document.createElement('div');
  grid.className = 'form-grid';

  if (type === '토지') {
    fields = [
      { id: 'f_대지', label: '대지 (㎡)', type: 'number' },
      { id: 'f_용도지역', label: '용도지역', type: 'text' },
      { id: 'f_지구구역', label: '지구.구역', type: 'text' }
    ];
  } else if (type === '상가') {
    fields = [
      { id: 'f_연면적', label: '연면적 (㎡)', type: 'number' },
      { id: 'f_전용', label: '전용 (㎡)', type: 'number' },
      { id: 'f_해당층총층', label: '해당층/총층', type: 'text' },
      { id: 'f_현업종', label: '현업종', type: 'text' },
      { id: 'f_추천업종', label: '추천업종', type: 'text' },
      { id: 'f_임대현황', label: '임대현황', type: 'text' }
    ];
  } else if (type === '공장창고') {
    fields = [
      { id: 'f_연면적', label: '연면적 (㎡)', type: 'number' },
      { id: 'f_대지', label: '대지 (㎡)', type: 'number' },
      { id: 'f_사용전력', label: '사용전력 (kW)', type: 'number' },
      { id: 'f_층고', label: '층고 (m)', type: 'number' },
      { id: 'f_용도지역', label: '용도지역', type: 'text' }
    ];
  } else if (type === '주택') {
    fields = [
      { id: 'f_대지', label: '대지 (㎡)', type: 'number' },
      { id: 'f_전용', label: '전용 (㎡)', type: 'number' },
      { id: 'f_공급', label: '공급 (㎡)', type: 'number' },
      { id: 'f_방', label: '방', type: 'number' },
      { id: 'f_욕실', label: '욕실', type: 'number' },
      { id: 'f_건축물용도', label: '건축물용도', type: 'text' },
      { id: 'f_건물명', label: '건물명', type: 'text' },
      { id: 'f_해당동', label: '해당동', type: 'text' },
      { id: 'f_호수', label: '호수', type: 'text' },
      { id: 'f_해당층총층', label: '해당층/총층', type: 'text' },
      { id: 'f_방향', label: '방향', type: 'text' },
      { id: 'f_주차', label: '주차', type: 'text' },
      { id: 'f_세대수', label: '세대수', type: 'number' },
      { id: 'f_사용승인일', label: '사용승인일', type: 'date' },
      { id: 'f_특수구조', label: '특수구조 (복층/다락)', type: 'text' },
      { id: 'f_특수구조상세', label: '특수구조 상세', type: 'text' },
      { id: 'f_반려동물', label: '반려동물 (가능/불가/협의)', type: 'text' },
      { id: 'f_엘리베이터', label: '엘리베이터', type: 'text' }
    ];
  }

  fields.forEach(f => {
    var div = document.createElement('div');
    div.className = 'form-field';
    div.innerHTML = '<label>' + f.label + '</label>'
      + '<input type="' + (f.type || 'text') + '" id="' + f.id + '">';
    grid.appendChild(div);
  });

  container.appendChild(grid);
}

// ============================================================
// 거래 조건 체크박스 토글
// ============================================================
document.querySelectorAll('.deal-check input[type="checkbox"]').forEach(cb => {
  cb.addEventListener('change', function() {
    var type = this.dataset.type;
    var row = this.closest('.deal-row');
    var inputs = row.querySelectorAll('.deal-inputs input');
    inputs.forEach(inp => {
      inp.disabled = !this.checked;
      if (!this.checked) inp.value = '';
    });
  });
});

// ============================================================
// 고객 검색
// ============================================================
document.getElementById('btnSearchCustomer').addEventListener('click', searchCustomer);
document.getElementById('f_customerSearch').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    searchCustomer();
  }
});

function searchCustomer() {
  var keyword = document.getElementById('f_customerSearch').value.trim();
  if (!keyword) {
    alert('검색어를 입력하세요');
    return;
  }

  var resultsEl = document.getElementById('customerSearchResults');
  resultsEl.innerHTML = '<div class="search-result-item">검색 중...</div>';
  resultsEl.classList.remove('hidden');

  var url = API_URL + '?action=searchCustomers'
          + '&keyword=' + encodeURIComponent(keyword)
          + '&email=' + encodeURIComponent(authEmail);

  fetch(url)
    .then(r => r.json())
    .then(data => {
      if (data.error) throw new Error(data.error);
      var list = data.results || [];
      if (!list.length) {
        resultsEl.innerHTML = '<div class="search-result-item">검색 결과 없음</div>';
        return;
      }
      resultsEl.innerHTML = '';
      list.forEach(c => {
        var item = document.createElement('div');
        item.className = 'search-result-item';
        item.innerHTML = '<div class="name">' + escapeHtml(c.고객명 || '이름없음')
          + ' <span style="font-size:11px;color:#4A90E2;">[' + escapeHtml(c.고객유형 || '') + ']</span></div>'
          + '<div class="meta">' + escapeHtml(c.연락처 || '') + ' · ' + escapeHtml(c.거래유형 || '') + '</div>';
        item.addEventListener('click', function() {
          selectCustomer(c);
        });
        resultsEl.appendChild(item);
      });
    })
    .catch(err => {
      resultsEl.innerHTML = '<div class="search-result-item">오류: ' + escapeHtml(err.message) + '</div>';
    });
}

function selectCustomer(c) {
  document.getElementById('f_고객ID').value = c.고객ID || '';
  document.getElementById('selectedCustomerInfo').textContent =
    (c.고객명 || '') + ' (' + (c.연락처 || '연락처 없음') + ')';
  document.getElementById('selectedCustomer').classList.remove('hidden');
  document.getElementById('customerSearchResults').classList.add('hidden');
  document.getElementById('newCustomerForm').classList.add('hidden');
}

document.getElementById('btnClearCustomer').addEventListener('click', function() {
  document.getElementById('f_고객ID').value = '';
  document.getElementById('selectedCustomer').classList.add('hidden');
});

// ============================================================
// 신규 고객 폼 토글
// ============================================================
document.getElementById('btnNewCustomer').addEventListener('click', function() {
  var form = document.getElementById('newCustomerForm');
  var isHidden = form.classList.contains('hidden');
  form.classList.toggle('hidden', !isHidden);
  document.getElementById('selectedCustomer').classList.add('hidden');
  document.getElementById('customerSearchResults').classList.add('hidden');
  if (isHidden) {
    document.getElementById('f_고객ID').value = '';
  }
});

// ============================================================
// 좌표 자동 조회
// ============================================================
document.getElementById('btnGeocode').addEventListener('click', function() {
  var 소재지 = document.getElementById('f_소재지').value;
  var 산 = document.getElementById('f_산').value;
  var 본번 = document.getElementById('f_본번').value.trim();
  var 부번 = document.getElementById('f_부번').value.trim();

  var status = document.getElementById('geocodeStatus');

  // 지번주소 자동 생성
  var 지번주소 = '';
  if (소재지) {
    지번주소 = 소재지;
    if (산) 지번주소 += ' 산';
    if (본번) 지번주소 += ' ' + 본번;
    if (부번) 지번주소 += '-' + 부번;
  }
  document.getElementById('f_지번주소').value = 지번주소;

  if (!소재지) {
    status.textContent = '소재지를 선택하세요';
    status.className = 'geocode-status error';
    return;
  }

  // 1차: Locations 캐시 조회 (지번주소로 정확한 값이 있으면 우선)
  var fullAddr = 지번주소 || 소재지;

  status.textContent = '조회 중...';
  status.className = 'geocode-status';

  var url = API_URL + '?action=geocodeAddress'
          + '&address=' + encodeURIComponent(fullAddr)
          + '&email=' + encodeURIComponent(authEmail);

  fetch(url)
    .then(r => r.json())
    .then(data => {
      if (data.error) {
        status.textContent = '조회 실패: ' + data.error;
        status.className = 'geocode-status error';
        return;
      }
      var coordStr = data.lat + ',' + data.lng;
      document.getElementById('f_좌표').value = coordStr;
      status.textContent = '✓ 조회 완료 (' + (data.source || 'kakao') + ')';
      status.className = 'geocode-status success';
    })
    .catch(err => {
      status.textContent = '오류: ' + err.message;
      status.className = 'geocode-status error';
    });
});

// ============================================================
// 저장
// ============================================================
document.getElementById('btnSaveAdd').addEventListener('click', function() {
  var btn = this;

  // 필수 검증
  var 매물명 = document.getElementById('f_매물명').value.trim();
  var 매물유형 = document.getElementById('f_매물유형').value;
  var 소재지 = document.getElementById('f_소재지').value;
  var 좌표 = document.getElementById('f_좌표').value.trim();

  if (!매물명) { alert('매물명을 입력하세요'); return; }
  if (!매물유형) { alert('매물유형을 선택하세요'); return; }
  if (!소재지) { alert('소재지를 선택하세요'); return; }
  if (!좌표) { alert('좌표 자동 조회를 먼저 실행하세요'); return; }

  // 고객 검증
  var 고객ID = document.getElementById('f_고객ID').value;
  var 신규고객 = false;
  var 신규고객명 = '';

  if (!고객ID) {
    // 신규 고객 폼이 열려있으면 신규 등록
    var newForm = document.getElementById('newCustomerForm');
    if (!newForm.classList.contains('hidden')) {
      신규고객명 = document.getElementById('f_신규고객명').value.trim();
      if (!신규고객명) { alert('신규 고객명을 입력하세요'); return; }
      신규고객 = true;
    } else {
      alert('소유주를 선택하거나 신규 등록하세요');
      return;
    }
  }

  // 거래 조건 검증
  var dealTypes = [];
  ['매매', '전세', '연세', '월세', '단기'].forEach(t => {
    var cb = document.getElementById('deal_' + t);
    if (cb && cb.checked) dealTypes.push(t);
  });

  if (!dealTypes.length) {
    alert('거래 조건을 1개 이상 선택하세요');
    return;
  }

  // 저장 데이터 준비
  var params = {};

  // 기본 정보
  params['매물명'] = 매물명;
  params['매물유형'] = 매물유형;
  params['매물유형상세'] = document.getElementById('f_매물유형상세').value;
  params['매물상태'] = document.getElementById('f_매물상태').value;

  // 위치
  params['소재지'] = 소재지;
  params['산'] = document.getElementById('f_산').value;
  params['본번'] = document.getElementById('f_본번').value.trim();
  params['부번'] = document.getElementById('f_부번').value.trim();
  params['지번주소'] = document.getElementById('f_지번주소').value;
  params['좌표'] = 좌표;
  params['추가필지'] = '';

  // 고객
  params['고객ID'] = 고객ID;
  if (신규고객) {
    params['신규고객'] = 'true';
    params['신규고객명'] = 신규고객명;
    params['신규고객연락처'] = document.getElementById('f_신규고객연락처').value;
    params['신규고객유형'] = document.getElementById('f_신규고객유형').value;
    params['신규고객거래유형'] = document.getElementById('f_신규고객거래유형').value;
  }

  // 거래 조건 (첫 번째만 저장 - 매물ID 분리 방식은 다음 단계에서)
  var mainDeal = dealTypes[0];
  params['거래유형'] = mainDeal;

  if (mainDeal === '매매') {
    params['매매가'] = document.getElementById('f_매매가').value;
  } else if (mainDeal === '전세') {
    params['보증금'] = document.getElementById('f_보증금_전세').value;
  } else if (mainDeal === '연세') {
    params['연세'] = document.getElementById('f_연세').value;
  } else if (mainDeal === '월세') {
    params['보증금'] = document.getElementById('f_보증금_월세').value;
    params['월세'] = document.getElementById('f_월세').value;
  } else if (mainDeal === '단기') {
    params['보증금'] = document.getElementById('f_보증금_단기').value;
    params['월세'] = document.getElementById('f_월세_단기').value;
  }

  // 공통 금액
  params['관리비'] = document.getElementById('f_관리비').value;
  params['권리금'] = document.getElementById('f_권리금').value;

  // 유형별 상세 (있는 필드만)
  ['f_대지', 'f_용도지역', 'f_지구구역', 'f_연면적', 'f_전용', 'f_공급', 'f_해당층총층',
   'f_현업종', 'f_추천업종', 'f_임대현황', 'f_사용전력', 'f_층고',
   'f_방', 'f_욕실', 'f_건축물용도', 'f_건물명', 'f_해당동', 'f_호수',
   'f_방향', 'f_주차', 'f_세대수', 'f_사용승인일', 'f_특수구조', 'f_특수구조상세',
   'f_반려동물', 'f_엘리베이터'].forEach(id => {
    var el = document.getElementById(id);
    if (el) {
      var key = id.replace('f_', '');
      // 필드명 매핑
      var keyMap = {
        '특수구조상세': '특수구조(상세)',
        '지구구역': '지구.구역',
        '해당층총층': '해당층/총층'
      };
      params[keyMap[key] || key] = el.value;
    }
  });

  // 기타
  params['블로그링크'] = document.getElementById('f_블로그링크').value;
  params['내용'] = document.getElementById('f_내용').value;

  // 전송
  btn.disabled = true;
  btn.textContent = '저장 중...';

  var queryString = Object.keys(params).map(k =>
    encodeURIComponent(k) + '=' + encodeURIComponent(params[k])
  ).join('&');

  var url = API_URL + '?action=addProperty&email=' + encodeURIComponent(authEmail) + '&' + queryString;

  fetch(url)
    .then(r => r.json())
    .then(data => {
      btn.disabled = false;
      btn.textContent = '저장';

      if (data.error) {
        alert('저장 실패: ' + data.error);
        return;
      }

      alert('저장 완료!\n매물ID: ' + data.매물ID + '\n고객ID: ' + data.고객ID);
      closeAddModal();

      // 데이터 새로고침
      fetchAllData().then(() => {
        renderList();
        renderMarkers();
      });
    })
    .catch(err => {
      btn.disabled = false;
      btn.textContent = '저장';
      alert('오류: ' + err.message);
    });
});

