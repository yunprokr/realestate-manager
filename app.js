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
  console.log('[openAddModal] 시작');
  resetAddForm();
  document.getElementById('addPropertyModal').classList.remove('hidden');

  initLocationCombobox();
  bindNameGenerationTriggers();
  bindPhoneFormat();  // ⭐ 추가

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

  // ⭐ 소재지 Combobox 초기화
  if (typeof locationCombobox !== 'undefined' && locationCombobox.input) {
    locationCombobox.input.value = '';
    locationCombobox.input.dataset.value = '';
    locationCombobox.selectedValue = '';
    if (typeof closeLocationDropdown === 'function') {
      closeLocationDropdown();
    }
  }

  // ⭐ 매물명 수동 수정 플래그 초기화
  if (typeof propertyNameManuallyEdited !== 'undefined') {
    propertyNameManuallyEdited = false;
  }

  // ⭐ 매물명 힌트 초기화
  var hint = document.getElementById('nameHint');
  if (hint) {
    hint.textContent = '';
    hint.className = 'field-hint';
  }
}


// ============================================================
// 매물명 자동 생성 트리거
// ============================================================

// 매물명이 수동 수정되었는지 추적
var propertyNameManuallyEdited = false;

// 매물명 입력 시 수동 수정 표시
document.getElementById('f_매물명').addEventListener('input', function() {
  propertyNameManuallyEdited = true;
  updateNameHint();
});

// 자동 생성 버튼 클릭
document.getElementById('btnGenerateName').addEventListener('click', function() {
  var name = generatePropertyName();
  if (!name) {
    alert('매물유형, 소재지 등 필수 정보를 먼저 입력하세요');
    return;
  }
  if (propertyNameManuallyEdited) {
    if (!confirm('매물명이 수정되었습니다. 자동 생성으로 덮어쓸까요?')) {
      return;
    }
  }
  document.getElementById('f_매물명').value = name;
  propertyNameManuallyEdited = false;
  updateNameHint();
});

// 자동 생성 트리거 (필드 변경 시)
['f_매물유형', 'f_매물유형상세', 'f_소재지', 'f_산', 'f_본번', 'f_부번',
 'f_용도지역', 'f_대지', 'f_전용', 'f_연면적',
 'f_건물명', 'f_해당동', 'f_호수',
 'f_매매가', 'f_보증금_전세', 'f_연세', 'f_보증금_월세', 'f_월세',
 'f_보증금_단기', 'f_월세_단기', 'f_권리금'].forEach(id => {
  var el = document.getElementById(id);
  if (el) {
    el.addEventListener('change', autoGenerateName);
    el.addEventListener('input', debounce(autoGenerateName, 500));
  }
});

// 거래 조건 체크박스도 트리거
document.querySelectorAll('.deal-check input[type="checkbox"]').forEach(cb => {
  cb.addEventListener('change', autoGenerateName);
});


// 자동 생성 (수동 수정 안 했을 때만)
function autoGenerateName() {
  console.log('[autoGenerateName] 호출됨. 수동수정여부:', propertyNameManuallyEdited);

  if (propertyNameManuallyEdited) return;

  var name = generatePropertyName();
  console.log('[autoGenerateName] 생성된 이름:', name);

  if (name) {
    document.getElementById('f_매물명').value = name;
    updateNameHint();
  }
}


// 힌트 표시
function updateNameHint() {
  var hint = document.getElementById('nameHint');
  if (!hint) return;

  if (propertyNameManuallyEdited) {
    hint.textContent = '⚠ 수동 수정됨 · 자동 생성하려면 🔄 버튼 클릭';
    hint.className = 'field-hint warning';
  } else if (document.getElementById('f_매물명').value) {
    hint.textContent = '✓ 자동 생성됨';
    hint.className = 'field-hint success';
  } else {
    hint.textContent = '';
    hint.className = 'field-hint';
  }
}

// 모달 열 때 초기화
// (기존 openAddModal 함수 내부 수정)
var _originalOpenAddModal = openAddModal;
openAddModal = function() {
  propertyNameManuallyEdited = false;
  _originalOpenAddModal();
};


// ============================================================
// 소재지 Combobox (자동완성 + 드롭다운)
// ============================================================
var locationCombobox = {
  input: null,
  dropdown: null,
  highlightedIndex: -1,
  filteredItems: [],
  selectedValue: ''
};

function initLocationCombobox() {
  console.log('[Combobox] 초기화 시작');

  var input = document.getElementById('f_소재지');
  var dropdown = document.getElementById('locationDropdown');
  var toggleBtn = document.getElementById('btnToggleLocation');

  if (!input || !dropdown || !toggleBtn) {
    console.error('[Combobox] 필수 요소 없음', {input, dropdown, toggleBtn});
    return;
  }

  // 이미 초기화됐으면 스킵
  if (locationCombobox.input === input) {
    console.log('[Combobox] 이미 초기화됨');
    return;
  }

  locationCombobox.input = input;
  locationCombobox.dropdown = dropdown;

  // 입력 시 검색
  input.addEventListener('input', function() {
    var keyword = input.value.trim();
    filterAndShowLocations(keyword);
    locationCombobox.selectedValue = '';
  });

  // 포커스 시 드롭다운 열기
  input.addEventListener('focus', function() {
    filterAndShowLocations(input.value.trim());
  });

  // 키보드 네비게이션
  input.addEventListener('keydown', function(e) {
    if (dropdown.classList.contains('hidden')) {
      if (e.key === 'ArrowDown') {
        filterAndShowLocations(input.value.trim());
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      locationCombobox.highlightedIndex++;
      if (locationCombobox.highlightedIndex >= locationCombobox.filteredItems.length) {
        locationCombobox.highlightedIndex = 0;
      }
      updateHighlight();
      scrollToHighlighted();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      locationCombobox.highlightedIndex--;
      if (locationCombobox.highlightedIndex < 0) {
        locationCombobox.highlightedIndex = locationCombobox.filteredItems.length - 1;
      }
      updateHighlight();
      scrollToHighlighted();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (locationCombobox.highlightedIndex >= 0) {
        selectLocation(locationCombobox.filteredItems[locationCombobox.highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      closeLocationDropdown();
    }
  });

  // 토글 버튼
  toggleBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    e.preventDefault();
    if (dropdown.classList.contains('hidden')) {
      filterAndShowLocations(input.value.trim());
      input.focus();
    } else {
      closeLocationDropdown();
    }
  });

  // 외부 클릭 시 닫기
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.location-combobox-wrapper')) {
      closeLocationDropdown();
    }
  });

  console.log('[Combobox] 초기화 완료');
}

function filterAndShowLocations(keyword) {
  console.log('[Combobox] 필터:', keyword, '/ 전체 지역:', allLocations.length);

  var dropdown = locationCombobox.dropdown;
  if (!dropdown) return;

  if (!allLocations || allLocations.length === 0) {
    dropdown.innerHTML = '<div class="combobox-empty">지역 데이터 로드 중...</div>';
    dropdown.classList.remove('hidden');
    return;
  }

  var filtered;
  if (!keyword) {
    filtered = allLocations.slice(0, 100);
  } else {
    var kw = keyword.toLowerCase();
    filtered = allLocations.filter(function(loc) {
      return (loc.Location || '').toLowerCase().indexOf(kw) !== -1;
    });
  }

  console.log('[Combobox] 필터 결과:', filtered.length);

  locationCombobox.filteredItems = filtered;
  locationCombobox.highlightedIndex = -1;

  if (!filtered.length) {
    dropdown.innerHTML = '<div class="combobox-empty">검색 결과 없음</div>';
  } else {
    var html = '';
    filtered.forEach(function(loc, i) {
      var selected = (loc.Location === locationCombobox.selectedValue) ? ' selected' : '';
      html += '<div class="combobox-item' + selected + '" data-index="' + i + '">'
            + escapeHtml(loc.Location) + '</div>';
    });
    dropdown.innerHTML = html;

    dropdown.querySelectorAll('.combobox-item').forEach(function(item) {
      item.addEventListener('click', function() {
        var idx = parseInt(this.dataset.index, 10);
        selectLocation(locationCombobox.filteredItems[idx]);
      });
      item.addEventListener('mouseenter', function() {
        locationCombobox.highlightedIndex = parseInt(this.dataset.index, 10);
        updateHighlight();
      });
    });
  }

  dropdown.classList.remove('hidden');
}

function updateHighlight() {
  var items = locationCombobox.dropdown.querySelectorAll('.combobox-item');
  items.forEach(function(item, i) {
    item.classList.toggle('highlighted', i === locationCombobox.highlightedIndex);
  });
}

function scrollToHighlighted() {
  var items = locationCombobox.dropdown.querySelectorAll('.combobox-item');
  if (locationCombobox.highlightedIndex >= 0 && items[locationCombobox.highlightedIndex]) {
    items[locationCombobox.highlightedIndex].scrollIntoView({ block: 'nearest' });
  }
}

function selectLocation(loc) {
  if (!loc) return;
  console.log('[Combobox] 선택:', loc.Location);

  locationCombobox.input.value = loc.Location;
  locationCombobox.selectedValue = loc.Location;
  locationCombobox.input.dataset.value = loc.Location;
  closeLocationDropdown();

  if (typeof autoGenerateName === 'function') {
    autoGenerateName();
  }
}

function closeLocationDropdown() {
  if (locationCombobox.dropdown) {
    locationCombobox.dropdown.classList.add('hidden');
  }
  locationCombobox.highlightedIndex = -1;
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
      { id: 'f_건축물용도', label: '건축물용도', type: 'text', placeholder: '예: 다세대주택, 단독주택' },
      { id: 'f_건물명', label: '건물명', type: 'text', placeholder: '예: 마크힐노형' },
      { id: 'f_해당동', label: '해당동', type: 'text', placeholder: '숫자만 (예: 102)' },
      { id: 'f_호수', label: '호수', type: 'text', placeholder: '숫자만 (예: 401)' },
      { id: 'f_해당층총층', label: '해당층/총층', type: 'text', placeholder: '예: 4층/총4층' },
      { id: 'f_방향', label: '방향', type: 'text', placeholder: '예: 남서향' },
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
    var placeholder = f.placeholder ? ' placeholder="' + f.placeholder + '"' : '';
    div.innerHTML = '<label>' + f.label + '</label>'
      + '<input type="' + (f.type || 'text') + '" id="' + f.id + '"' + placeholder + '>';
    grid.appendChild(div);
  });

  container.appendChild(grid);

  // ⭐ 새로 생성된 필드에 자동생성 트리거 연결
  bindNameGenerationTriggers();
}

// ============================================================
// 매물명 자동생성 트리거 재연결
// ============================================================
function bindNameGenerationTriggers() {
  var ids = [
    'f_매물유형', 'f_매물유형상세', 'f_소재지', 'f_산', 'f_본번', 'f_부번',
    'f_용도지역', 'f_지구구역', 'f_대지', 'f_전용', 'f_공급', 'f_연면적',
    'f_건물명', 'f_해당동', 'f_호수',
    'f_매매가', 'f_보증금_전세', 'f_연세', 'f_보증금_월세', 'f_월세',
    'f_보증금_단기', 'f_월세_단기', 'f_권리금'
  ];

  ids.forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    // 이미 바인딩됐는지 확인 (중복 방지)
    if (el.dataset.nameTriggerBound === '1') return;
    el.dataset.nameTriggerBound = '1';

    el.addEventListener('change', autoGenerateName);
    el.addEventListener('input', debounce(autoGenerateName, 400));
  });
}


// ============================================================
// 📝 매물명 자동 생성
// ============================================================

// 평 변환 (1㎡ = 0.3025평)
function sqmToPyeong(sqm) {
  var n = parseFloat(sqm);
  if (isNaN(n) || n <= 0) return '';
  return (n * 0.3025).toFixed(1);
}

// 소재지 축약 (예: "제주시 해안동" → "해안동")
function shortLocation(소재지) {
  if (!소재지) return '';
  // "제주시 해안동" → "해안동"
  // "서귀포시 표선면 세화리" → "세화리"
  var parts = 소재지.trim().split(/\s+/);
  return parts[parts.length - 1];
}

// 지번 문자열 생성
function buildJibunStr() {
  var 소재지 = document.getElementById('f_소재지').value;
  var 산 = document.getElementById('f_산').value;
  var 본번 = document.getElementById('f_본번').value.trim();
  var 부번 = document.getElementById('f_부번').value.trim();

  var addr = shortLocation(소재지);
  if (산) addr += ' 산';
  if (본번) addr += ' ' + 본번;
  if (부번) addr += '-' + 부번;
  return addr;
}

// 금액 포맷
function formatDealPrice() {
  var deals = getSelectedDeals();
  if (!deals.length) return '';

  var d = deals[0]; // 첫 번째 거래만
  var t = d.type;

  if (t === '매매') {
    var v = document.getElementById('f_매매가').value;
    return v ? '매매 ' + Number(v).toLocaleString() + '만원' : '매매';
  }
  if (t === '전세') {
    var v2 = document.getElementById('f_보증금_전세').value;
    return v2 ? '전세 ' + Number(v2).toLocaleString() + '만원' : '전세';
  }
  if (t === '연세') {
    var v3 = document.getElementById('f_연세').value;
    return v3 ? '연세 ' + Number(v3).toLocaleString() + '만원' : '연세';
  }
  if (t === '월세') {
    var b1 = document.getElementById('f_보증금_월세').value || '0';
    var m1 = document.getElementById('f_월세').value || '0';
    return '보증금' + Number(b1).toLocaleString() + '/월세' + Number(m1).toLocaleString();
  }
  if (t === '단기') {
    var b2 = document.getElementById('f_보증금_단기').value || '0';
    var m2 = document.getElementById('f_월세_단기').value || '0';
    return '단기 보증금' + Number(b2).toLocaleString() + '/월세' + Number(m2).toLocaleString();
  }
  return '';
}

// 선택된 거래 목록
function getSelectedDeals() {
  var deals = [];
  ['매매', '전세', '연세', '월세', '단기'].forEach(t => {
    var cb = document.getElementById('deal_' + t);
    if (cb && cb.checked) deals.push({ type: t });
  });
  return deals;
}

// ============================================================
// 매물명 자동 생성 (핵심)
// ============================================================
function generatePropertyName() {
  var 매물유형 = document.getElementById('f_매물유형').value;
  var 매물유형상세 = document.getElementById('f_매물유형상세').value;
  var 지번 = buildJibunStr();

  if (!매물유형) return '';

  var parts = ['[' + 매물유형 + ']'];

  if (매물유형 === '토지') {
    // [토지] 매물유형상세 지번 용도지역 면적평 매매가 평당가
    if (매물유형상세) parts.push(매물유형상세);
    if (지번) parts.push(지번);

    var 용도지역 = document.getElementById('f_용도지역').value;
    if (용도지역) parts.push(용도지역);

    var 대지 = document.getElementById('f_대지').value;
    var 평 = sqmToPyeong(대지);
    if (평) parts.push(평 + '평');

    var 매매가 = document.getElementById('f_매매가').value;
    if (매매가) {
      parts.push(Number(매매가).toLocaleString() + '만원');

      // 평당가 계산 (면적 있을 때)
      if (평 && parseFloat(평) > 0) {
        var 평당 = Math.round(Number(매매가) / parseFloat(평));
        parts.push(평당.toLocaleString() + '만원/평');
      }
    }
  }
  else if (매물유형 === '상가') {
    // [상가] 매물유형상세 지번 (보증금/월세 | 매매가) 전용평 [권리금]
    if (매물유형상세) parts.push(매물유형상세);
    if (지번) parts.push(지번);

    var dealStr = formatDealPrice();
    if (dealStr) parts.push(dealStr);

    var 전용 = document.getElementById('f_전용').value;
    var 평2 = sqmToPyeong(전용);
    if (평2) parts.push(평2 + '평');

    var 권리금 = document.getElementById('f_권리금').value;
    if (권리금) parts.push('권리금' + Number(권리금).toLocaleString());
  }
else if (매물유형 === '주택') {
  // [주택] 매물유형상세 지번 [건물명] [동] [호수] 전용평 거래유형 금액
  if (매물유형상세) parts.push(매물유형상세);
  if (지번) parts.push(지번);

  // 건물명
  var 건물명 = document.getElementById('f_건물명') ? document.getElementById('f_건물명').value.trim() : '';
  if (건물명) parts.push(건물명);

  // ⭐ 해당동: "동" 자동 붙이기
  var 해당동 = document.getElementById('f_해당동') ? document.getElementById('f_해당동').value.trim() : '';
  if (해당동) {
    // 이미 "동"으로 끝나면 그대로, 아니면 "동" 추가
    if (!해당동.endsWith('동')) {
      해당동 += '동';
    }
    parts.push(해당동);
  }

  // ⭐ 호수: "호" 자동 붙이기
  var 호수 = document.getElementById('f_호수') ? document.getElementById('f_호수').value.trim() : '';
  if (호수) {
    if (!호수.endsWith('호')) {
      호수 += '호';
    }
    parts.push(호수);
  }

  // 전용면적
  var 전용2 = document.getElementById('f_전용') ? document.getElementById('f_전용').value : '';
  var 평3 = sqmToPyeong(전용2);
  if (평3) parts.push(평3 + '평');

  // 거래 금액
  var dealStr2 = formatDealPrice();
  if (dealStr2) parts.push(dealStr2);
}
  else if (매물유형 === '공장창고') {
    // [공장창고] 매물유형상세 지번 [대지평] [연면적평] 거래유형 금액
    if (매물유형상세) parts.push(매물유형상세);
    if (지번) parts.push(지번);

    var 대지2 = document.getElementById('f_대지') ? document.getElementById('f_대지').value : '';
    var 평4 = sqmToPyeong(대지2);
    if (평4) parts.push('대지' + 평4 + '평');

    var 연면적 = document.getElementById('f_연면적') ? document.getElementById('f_연면적').value : '';
    var 평5 = sqmToPyeong(연면적);
    if (평5) parts.push('연면적' + 평5 + '평');

    var dealStr3 = formatDealPrice();
    if (dealStr3) parts.push(dealStr3);
  }

  return parts.join(' ');
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
  // ⭐ 여기에 추가 ⭐
  // 소재지가 Locations 목록에 있는지 검증
  var isValidLocation = allLocations.some(function(loc) {
    return loc.Location === 소재지;
  });
  if (!isValidLocation) {
    status.textContent = '⚠ 소재지를 목록에서 선택하세요 (현재: ' + 소재지 + ')';
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

// ============================================================
// 연락처 자동 포맷 (01012345678 → 010-1234-5678)
// ============================================================
function formatPhoneNumber(input) {
  var num = input.value.replace(/[^0-9]/g, '');
  if (num.length <= 3) {
    input.value = num;
  } else if (num.length <= 7) {
    input.value = num.substr(0, 3) + '-' + num.substr(3);
  } else if (num.length <= 11) {
    input.value = num.substr(0, 3) + '-' + num.substr(3, 4) + '-' + num.substr(7);
  } else {
    input.value = num.substr(0, 3) + '-' + num.substr(3, 4) + '-' + num.substr(7, 4);
  }
}

// 연락처 입력 필드에 자동 포맷 적용
function bindPhoneFormat() {
  ['f_신규고객연락처', 'f_customerSearch'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el && el.dataset.phoneBound !== '1') {
      el.dataset.phoneBound = '1';
      el.addEventListener('input', function() {
        formatPhoneNumber(this);
      });
    }
  });
}

