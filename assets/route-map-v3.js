/* Gangwon route planner — admin only. Inspection records are never read or written. */
(function () {
  'use strict';
  const KEY = 'daegi-admin-route-map-v3';
  const TRIPS_KEY = 'daegi-admin-route-trips-v1';
  const DATA = window.GANGWON_ROUTE_DATA;
  const byId = {};
  const byCity = {};
  const state = { selected: [], days: 1, plan: null, lodgingCity: '강릉시', lodgingPoint: null, tripId: '' };
  let trips = {events:[], drafts:{}};
  let map, districts, pointLayer, lineLayer, labelLayer, baseLayer, neighborsLayer, roadLayer;
  let roads = false;
  let initialized = false, detail = null, picking = false, storageFailed = false;
  const $ = id => document.getElementById(id);
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const colors = ['#173e66', '#078b83'];
  const announce = text => { $('rp-status').textContent = text; };
  const coord = p => [p.lat, p.lng];
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      if (state.tripId) trips.drafts[state.tripId]=JSON.parse(JSON.stringify(state));
      localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
      storageFailed = false;
    }
    catch (_) {
      if (!storageFailed) announce('일정 임시저장 공간이 부족합니다. 이 화면에서는 계속 사용할 수 있습니다.');
      storageFailed = true;
    }
  }
  function restore() {
    try {
      const savedTrips=JSON.parse(localStorage.getItem(TRIPS_KEY)||'null');
      if(savedTrips&&Array.isArray(savedTrips.events)) {
        trips.events=validateEvents(savedTrips.events);
        trips.drafts=savedTrips.drafts&&typeof savedTrips.drafts==='object'?savedTrips.drafts:{};
      }
      const old = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!old || !Array.isArray(old.selected)) return;
      applyDraft(old);
    } catch (_) { /* A damaged draft must not prevent opening the map. */ }
  }
  function applyDraft(old) {
      state.selected = [...new Set(old.selected.filter(code => typeof code === 'string' && byId[code]))];
      state.days = old.days === 2 ? 2 : 1;
      state.plan=null;state.lodgingPoint=null;
      state.tripId=trips.events.some(e=>e.id===old.tripId)?old.tripId:'';
      if (DATA.cities[old.lodgingCity]) state.lodgingCity = old.lodgingCity;
      if (old.lodgingPoint && Number.isFinite(old.lodgingPoint.lat) && Number.isFinite(old.lodgingPoint.lng) && inBounds(old.lodgingPoint)) {
        state.lodgingPoint = {lat:old.lodgingPoint.lat, lng:old.lodgingPoint.lng};
      }
      if (Array.isArray(old.plan) && old.plan.length === state.days && old.plan.every(Array.isArray)) {
        const flat = old.plan.flat();
        if (flat.length === state.selected.length && new Set(flat).size === flat.length && flat.every(code => state.selected.includes(code)) && flat.length) {
          state.plan = old.plan;
        }
      }
  }
  function validDate(value) {
    return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
  }
  function validateEvents(events) {
    if(!Array.isArray(events)||events.length>500) throw new Error('출장계획 events 형식을 확인해 주세요.');
    const ids=new Set();
    return events.map((event,i)=>{
      if(!event||typeof event.title!=='string'||!validDate(event.start)||!validDate(event.end)||event.end<event.start) throw new Error((i+1)+'번째 계획의 제목 또는 날짜를 확인해 주세요.');
      const id=String(event.id||'trip-'+i);
      if(['__proto__','constructor','prototype'].includes(id)||ids.has(id)) throw new Error('출장계획 ID가 중복되었거나 올바르지 않습니다.');
      ids.add(id);
      return {id,title:event.title.slice(0,250),start:event.start,end:event.end,detail:typeof event.detail==='string'?event.detail.slice(0,1500):''};
    }).sort((a,b)=>a.start.localeCompare(b.start));
  }
  function requirements(event) {
    return Object.keys(byCity).flatMap(city=>{
      const short=city.replace(/[시군]$/,'');
      const match=event.title.match(new RegExp(short+'(?:시|군)?\\s*(?:\\((\\d+)\\))?'));
      return match?[{city,count:match[1]?Number(match[1]):byCity[city].length}]:[];
    });
  }
  function renderTrips() {
    const sel=$('rp-trip-select');
    sel.innerHTML='<option value="">지도에서 직접 선택</option>'+trips.events.map(event=>'<option value="'+escape(event.id)+'">'+event.start.slice(5).replace('-','/')+(event.end!==event.start?'–'+event.end.slice(5).replace('-','/'):'')+' · '+escape(event.title)+'</option>').join('');
    sel.value=state.tripId;
    const note=$('rp-trip-note'),event=trips.events.find(e=>e.id===state.tripId);
    note.hidden=!event;if(!event)return;
    const needs=requirements(event), mismatches=[];
    needs.forEach(req=>{
      const current=state.selected.filter(code=>byId[code].city===req.city).length;
      if(current!==req.count)mismatches.push(req.city+' '+req.count+'곳 예정 / '+current+'곳 선택'+(req.count<byCity[req.city].length?' · 측정소를 직접 선택하세요.':''));
    });
    const extra=state.selected.filter(code=>!needs.some(r=>r.city===byId[code].city));
    if(extra.length&&needs.length)mismatches.push('계획 외 지역 '+extra.length+'곳이 선택되어 있습니다.');
    if(!needs.length)mismatches.push('제목에서 지역을 찾지 못했습니다. 방문 측정소를 지도에서 선택하세요.');
    const memoDates=event.detail.match(/\d{4}-\d{2}-\d{2}/g)||[];
    const conflict=memoDates.filter(date=>date<event.start||date>event.end);
    if(conflict.length)mismatches.push('날짜 확인 필요: 일정 '+event.start+' / 메모 '+[...new Set(conflict)].join(', '));
    const previous=new Set();
    Object.entries(trips.drafts).forEach(([id,draft])=>{
      if(id!==event.id&&Array.isArray(draft.selected)) draft.selected.forEach(code=>{if(state.selected.includes(code))previous.add(byId[code]?byId[code].name:code);});
    });
    if(previous.size)mismatches.push('다른 출장에도 선택된 측정소: '+[...previous].join(', '));
    const duration=Math.round((Date.parse(event.end)-Date.parse(event.start))/86400000)+1;
    if(duration>2)mismatches.push('3일 이상 일정입니다. 이 지도는 최대 2일 방문 순서를 추천합니다.');
    note.innerHTML='<strong>'+escape(event.start+(event.end!==event.start?' ~ '+event.end:''))+'</strong> · '+escape(event.title)+(mismatches.length?'<span class="rp-trip-warning">'+mismatches.map(escape).join('<br>')+'</span>':'');
  }
  function chooseTrip(id) {
    save();state.tripId=id;
    if(!id) {
      state.selected=[];state.plan=null;state.days=1;state.lodgingPoint=null;
      changed('지도에서 방문지를 직접 선택하세요.');return;
    }
    const event=trips.events.find(e=>e.id===id);if(!event)return;
    const draft=trips.drafts[id];
    if(draft&&Array.isArray(draft.selected))applyDraft(draft);
    else {
      state.selected=requirements(event).filter(r=>r.count===byCity[r.city].length).flatMap(r=>byCity[r.city].map(s=>s.code));
      state.days=event.start===event.end?1:2;state.plan=null;state.lodgingPoint=null;
      const needs=requirements(event);if(needs.length)state.lodgingCity=needs[needs.length-1].city;
    }
    detailClose();setPicking(false);changed('출장계획을 불러왔습니다. 선택한 측정소와 숙박 위치를 확인하세요.');
    if(state.selected.length)fitSelected();else {
      const needs=requirements(event);if(needs.length)viewCity(needs[0].city);
    }
  }
  async function importTrips(file) {
    if(!file)return;
    try {
      if(file.size>1024*1024)throw new Error('1 MB 이하 출장계획 JSON 파일을 선택해 주세요.');
      const input=JSON.parse((await file.text()).replace(/^\uFEFF/,''));
      const events=validateEvents(input.events);
      if(!events.length)throw new Error('출장계획이 비어 있습니다.');
      const drafts={};events.forEach(event=>{if(trips.drafts[event.id])drafts[event.id]=trips.drafts[event.id];});
      trips={events,drafts};
      if(!events.some(e=>e.id===state.tripId))state.tripId='';
      changed(events.length+'개 출장계획을 불러왔습니다. 위에서 날짜를 선택하세요.');
    } catch(error) {
      announce('계획을 불러오지 못했습니다. '+(error instanceof SyntaxError?'JSON 파일 형식을 확인해 주세요.':error.message));
    } finally {$('rp-trip-file').value='';}
  }
  function inBounds(p) { return p.lat >= 36.5 && p.lat <= 39 && p.lng >= 126.4 && p.lng <= 130.2; }
  function lodging() {
    const point = state.lodgingPoint || DATA.cities[state.lodgingCity].center;
    return {lat:point.lat, lng:point.lng, name:state.lodgingPoint ? '지정한 숙박 위치' : state.lodgingCity + ' 숙박 기준점'};
  }
  function invalidate() { state.plan = null; }
  function selected(code) { return state.selected.includes(code); }
  function changed(message) {
    save(); render(); announce(message+(storageFailed?' 저장 공간이 부족해 일정이 완전히 저장되지 않았습니다. 현재 화면에서만 사용할 수 있습니다.':''));
  }
  function toggleStation(code) {
    if (!byId[code]) return;
    const was = selected(code), hadPlan = !!state.plan;
    state.selected = was ? state.selected.filter(c => c !== code) : state.selected.concat(code);
    invalidate();
    detail = {type:'station', code};
    changed(byId[code].name + (was ? ' 선택을 해제했습니다.' : '을(를) 일정에 담았습니다.') + (hadPlan ? ' 방문 순서를 다시 추천해 주세요.' : ''));
  }
  function toggleCity(city) {
    const codes = byCity[city].map(s => s.code);
    const all = codes.every(selected), hadPlan = !!state.plan;
    state.selected = all ? state.selected.filter(c => !codes.includes(c)) : [...new Set(state.selected.concat(codes))];
    invalidate();
    changed(city + (all ? ' 측정소 선택을 해제했습니다.' : ' 측정소 ' + codes.length + '곳을 담았습니다.') + (hadPlan ? ' 방문 순서를 다시 추천해 주세요.' : ''));
  }
  function days(value) {
    if (state.days === value) return;
    state.days = value; invalidate(); setPicking(false);
    changed(value === 2 ? '숙박 위치를 확인한 뒤 방문 순서를 추천하세요.' : '당일 왕복으로 변경했습니다.');
  }
  function fitAll() {
    map.invalidateSize();
    map.fitBounds(districts.getBounds(), {padding:[30,28], animate:false});
  }
  function fitSelected() {
    const points = state.selected.map(code => coord(byId[code]));
    if (state.plan) {
      points.push(coord(DATA.base));
      if (state.days === 2) points.push(coord(lodging()));
    }
    if (!points.length) return;
    map.fitBounds(L.latLngBounds(points), {padding:[65,65], maxZoom:12, animate:false});
  }
  function viewStation(code) {
    if (!byId[code]) return;
    setPicking(false); detail = {type:'station', code};
    map.setView(coord(byId[code]), Math.max(map.getZoom(), 12), {animate:false});
    renderDetail();
    if (matchMedia('(max-width:850px)').matches) $('rp-map').scrollIntoView({behavior:'smooth', block:'center'});
  }
  function viewCity(city) {
    const layer = districts.getLayers().find(layer => layer.feature.properties.name === city);
    setPicking(false); detail = {type:'city', city};
    if (layer) map.fitBounds(layer.getBounds(), {padding:[35,35], maxZoom:11.5, animate:false});
    renderDetail();
  }
  function setPicking(value) {
    picking = value;
    $('rp-pick-banner').hidden = !value;
    $('rp-map').classList.toggle('rp-picking', value);
    if (value) {
      detail = null; renderDetail();
      const city = DATA.cities[state.lodgingCity].center;
      map.setView(coord(state.lodgingPoint || city), 11.5, {animate:false});
      announce('정확한 숙소 위치는 도로지도를 켜서 지정하세요.');
      if (matchMedia('(max-width:850px)').matches) $('rp-map').scrollIntoView({behavior:'smooth', block:'center'});
    }
  }
  function pickPoint(point) {
    if (!inBounds(point)) { announce('강원 지역과 가까운 숙박 위치를 선택하세요.'); return; }
    state.lodgingPoint = {lat:+point.lat.toFixed(6), lng:+point.lng.toFixed(6)};
    invalidate(); setPicking(false); changed('숙박 위치를 지정했습니다. 방문 순서를 다시 추천하세요.');
  }
  function stationAssignments() {
    const result = {};
    if (state.plan) state.plan.forEach((codes, day) => codes.forEach((code, i) => { result[code] = {day, number:i+1}; }));
    return result;
  }
  function bindMarker(marker, label, pressed) {
    const el = marker.getElement();
    if (el) {
      el.setAttribute('aria-label', label);
      if (pressed !== undefined) el.setAttribute('aria-pressed', String(pressed));
      el.addEventListener('keydown', event => {
        if (event.key === ' ') { event.preventDefault(); marker.fire('click'); }
      });
    }
  }
  function renderMarkers() {
    if (!map) return;
    pointLayer.clearLayers();
    const assignments = stationAssignments(), zoom = map.getZoom();
    Object.keys(byCity).forEach(city => {
      const groups = [];
      byCity[city].forEach(station => {
        const px = map.latLngToLayerPoint(coord(station));
        const group = groups.find(g => g.every(s => map.latLngToLayerPoint(coord(s)).distanceTo(px) < 45));
        if (group) group.push(station); else groups.push([station]);
      });
      groups.forEach(group => {
        if (group.length > 1) {
          const lat = group.reduce((n,s) => n+s.lat,0)/group.length, lng = group.reduce((n,s) => n+s.lng,0)/group.length;
          const count = group.filter(s => selected(s.code)).length;
          const assignedDays=[...new Set(group.filter(s=>assignments[s.code]).map(s=>assignments[s.code].day))];
          const clusterDay=assignedDays.length>1?' mixed-days':assignedDays[0]===1?' cluster-day-2':'';
          const marker = L.marker([lat,lng], {
            icon:L.divIcon({className:'rp-marker rp-cluster'+(count?' partial':'')+clusterDay, html:'<span class="rp-pin">'+group.length+'</span>', iconSize:[44,44],iconAnchor:[22,22]}),
            title:city+' 측정소 '+group.length+'곳, '+count+'곳 선택. 확대', keyboard:true
          }).addTo(pointLayer);
          marker.bindTooltip(city+' '+group.length+'곳'+(count?' · '+count+'곳 선택':''), {className:'rp-marker-label',direction:'bottom',offset:[0,10],permanent:true});
          marker.on('click', event => {
            if (picking) { pickPoint(event.latlng || marker.getLatLng()); return; }
            detail = {type:'city', city};
            map.fitBounds(L.latLngBounds(group.map(coord)), {padding:[85,85],maxZoom:14,animate:false});
            renderDetail();
          });
          bindMarker(marker, city+' 측정소 '+group.length+'곳. 누르면 확대');
        } else {
          const station = group[0], isSelected = selected(station.code), assignment = assignments[station.code];
          const day = assignment ? assignment.day : 0;
          const marker = L.marker(coord(station), {
            icon:L.divIcon({className:'rp-marker'+(isSelected?' selected day-'+(day+1):''),html:'<span class="rp-pin">'+(isSelected?(assignment?assignment.number:'✓'):'')+'</span>',iconSize:[44,44],iconAnchor:[22,22]}),
            title:station.city+' '+station.name+(isSelected?' 선택됨':' 선택'),keyboard:true,zIndexOffset:isSelected?400:0
          }).addTo(pointLayer);
          marker.bindTooltip(escape(station.name), {className:'rp-marker-label',direction:'bottom',offset:[0,12],permanent:zoom>=10.5 || isSelected});
          marker.on('click', event => {
            if (picking) { pickPoint(event.latlng || marker.getLatLng()); return; }
            const keyboard = event.originalEvent && event.originalEvent.type === 'keydown';
            toggleStation(station.code);
            if (keyboard) {
              const replacement = [...$('rp-map').querySelectorAll('[aria-label]')].find(el => el.getAttribute('aria-label').startsWith(station.city+' '+station.name+' '));
              if (replacement) replacement.focus();
            }
          });
          bindMarker(marker, station.city+' '+station.name+' '+(isSelected?'선택 해제':'선택'),isSelected);
          marker.getElement().dataset.station = station.code;
        }
      });
    });
    baseLayer.clearLayers();
    const base = L.marker(coord(DATA.base), {icon:L.divIcon({className:'rp-marker rp-base-marker',html:'<span>출</span>',iconSize:[44,44],iconAnchor:[22,22]}),title:'보건환경연구원 출발·도착',zIndexOffset:700}).addTo(baseLayer);
    base.bindTooltip('보건환경연구원', {className:'rp-marker-label',direction:'top',offset:[0,-14],permanent:zoom>=10});
    base.on('click', e => { if(picking) pickPoint(e.latlng||base.getLatLng()); else { detail={type:'base'}; renderDetail(); } });
    bindMarker(base,'보건환경연구원 출발·도착 위치');
    if (state.days === 2) {
      const stay = lodging();
      const marker = L.marker(coord(stay), {icon:L.divIcon({className:'rp-marker rp-lodging-marker',html:'<span>숙</span>',iconSize:[44,44],iconAnchor:[22,22]}),title:stay.name,zIndexOffset:650}).addTo(baseLayer);
      marker.bindTooltip(stay.name, {className:'rp-marker-label',direction:'top',offset:[0,-14],permanent:zoom>=10.5});
      marker.on('click', e => { if(picking) pickPoint(e.latlng||marker.getLatLng()); else { detail={type:'lodging'}; renderDetail(); } });
      bindMarker(marker,stay.name);
    }
  }
  function sequences() {
    if (!state.plan) return [];
    return state.plan.map((codes, i) => [i===0?DATA.base:lodging(), ...codes.map(code => byId[code]), i===state.days-1?DATA.base:lodging()]);
  }
  function renderLines() {
    lineLayer.clearLayers();
    sequences().forEach((seq,day) => {
      const points = seq.map(coord);
      L.polyline(points, {color:'#fff',weight:6,opacity:.85,interactive:false}).addTo(lineLayer);
      L.polyline(points, {color:colors[day],weight:2.5,opacity:.7,dashArray:'5 8',interactive:false}).addTo(lineLayer);
    });
  }
  function renderDistricts() {
    districts.eachLayer(layer => {
      const stations = byCity[layer.feature.properties.name] || [];
      const any = stations.some(s => selected(s.code));
      layer.setStyle({fillColor:any?'#e5eff4':'#fcfdfd',fillOpacity:roads?(any ? 0.25 : 0.04):1,color:roads?'#a9b9c5':'#bacbd3',weight:1.1});
    });
    labelLayer.eachLayer(layer => { const el = layer.getElement(); if(el) el.style.opacity = map.getZoom() > 11.5 ? '.5' : '1'; });
  }
  function detailClose() { detail=null; renderDetail(); }
  function renderDetail() {
    const el = $('rp-map-detail');
    el.hidden = !detail || picking;
    $('rp-map-guide').hidden = !!detail || picking;
    if (!detail || picking) return;
    let eyebrow, title, body, action, link;
    if (detail.type === 'station') {
      const s = byId[detail.code];
      eyebrow=s.city+' · '+s.network;title=s.name;body=s.loc;
      action='<button type="button" class="rp-button" data-toggle="'+s.code+'">'+(selected(s.code)?'✓ 선택됨 · 해제하기':'+ 방문 일정에 담기')+'</button>';
      link='https://map.naver.com/p/search/'+encodeURIComponent(s.loc);
    } else if (detail.type === 'city') {
      const all=byCity[detail.city], count=all.filter(s=>selected(s.code)).length;
      eyebrow='시군별 선택';title=detail.city;body='측정소 '+all.length+'곳 중 '+count+'곳 선택';
      action='<button type="button" class="rp-button" data-city="'+escape(detail.city)+'">'+(count===all.length?'지역 전체 선택 해제':'+ 지역 전체 선택')+'</button>';
    } else if (detail.type === 'base') {
      eyebrow='출발 · 복귀';title=DATA.base.name;body=DATA.base.loc+(DATA.base.approximate?' · 지도 위치는 기존 기준점입니다.':'');action='';
      link='https://map.naver.com/p/search/'+encodeURIComponent(DATA.base.loc+' '+DATA.base.name);
    } else {
      eyebrow='숙박';title=lodging().name;body=state.lodgingPoint?'직접 지정한 위치입니다. 실제 숙박업소 위치와 일치하는지 확인하세요.':'숙소 미지정: '+state.lodgingCity+' 기준점입니다. 지도에서 숙소 위치를 지정하면 더 정확하게 추천합니다.';
      action='<button type="button" class="rp-button" data-pick="true">숙박 위치 변경</button>';
    }
    el.innerHTML='<div class="rp-detail-top"><small>'+escape(eyebrow)+'</small><button type="button" class="rp-close" aria-label="위치 정보 닫기">×</button></div><h3>'+escape(title)+'</h3><p>'+escape(body)+'</p>'+action+(link?'<a class="rp-detail-link" href="'+escape(link)+'" target="_blank" rel="noopener noreferrer">네이버지도에서 위치 보기 ↗</a>':'');
    el.querySelector('.rp-close').onclick=detailClose;
    const toggle=el.querySelector('[data-toggle]'); if(toggle) toggle.onclick=()=>toggleStation(toggle.dataset.toggle);
    const city=el.querySelector('[data-city]'); if(city) city.onclick=()=>toggleCity(city.dataset.city);
    const pick=el.querySelector('[data-pick]'); if(pick) pick.onclick=()=>setPicking(true);
  }
  function distance(a,b) {
    const r = Math.PI/180, dlat=(b.lat-a.lat)*r, dlng=(b.lng-a.lng)*r;
    const x=Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlng/2)**2;
    return 6371*2*Math.atan2(Math.sqrt(Math.min(1,x)),Math.sqrt(Math.max(0,1-x)));
  }
  function length(nodes) { return nodes.slice(1).reduce((sum,node,i)=>sum+distance(nodes[i],node),0); }
  function improve(order, start, end) {
    let full=[start,...order,end], again=true, guard=0;
    while (again && guard++<60) {
      again=false;
      for(let i=1;i<full.length-2;i++) for(let j=i+1;j<full.length-1;j++) {
        const old=distance(full[i-1],full[i])+distance(full[j],full[j+1]);
        const next=distance(full[i-1],full[j])+distance(full[i],full[j+1]);
        if(next<old-.001) { full=full.slice(0,i).concat(full.slice(i,j+1).reverse(),full.slice(j+1));again=true; }
      }
    }
    return full;
  }
  function nearest(nodes, start, seed) {
    let remaining=nodes.slice(), order=[], current=start;
    if(seed) {current=seed;order.push(seed);remaining=remaining.filter(n=>n!==seed);}
    while(remaining.length) {
      let best=0;
      for(let i=1;i<remaining.length;i++) if(distance(current,remaining[i])<distance(current,remaining[best])) best=i;
      current=remaining.splice(best,1)[0];order.push(current);
    }
    return order;
  }
  function recommend() {
    if(!state.selected.length) return;
    setPicking(false);
    const nodes=state.selected.map(code=>byId[code]), base=DATA.base;
    let tour, best=Infinity;
    // Multiple starting candidates reduce dependence on the order of selection.
    nodes.forEach(seed=>{
      const candidate=improve(nearest(nodes,base,seed),base,base), score=length(candidate);
      if(score<best) {best=score;tour=candidate.slice(1,-1);}
    });
    if(state.days===1) state.plan=[tour.map(n=>n.code)];
    else {
      const stay=lodging();let split=null;
      [tour,tour.slice().reverse()].forEach(order=>{
        for(let k=1;k<=Math.max(1,order.length-1);k++) {
          const first=improve(order.slice(0,k),base,stay), second=improve(order.slice(k),stay,base);
          const a=length(first),b=length(second),score=Math.max(a,b)+.15*(a+b);
          if(!split||score<split.score) split={score,plan:[first.slice(1,-1).map(n=>n.code),second.slice(1,-1).map(n=>n.code)]};
        }
      });
      state.plan=split.plan;
    }
    changed('방문 순서를 추천했습니다. 화살표로 순서를 조정할 수 있습니다.');fitSelected();
  }
  function reorder(code, change) {
    if(!state.plan) return;
    const day=state.plan.findIndex(codes=>codes.includes(code)), i=state.plan[day].indexOf(code);
    if(change==='day' && state.days===2) {
      state.plan[day].splice(i,1);state.plan[1-day].push(code);
    } else {
      const target=i+(change==='up'?-1:1);
      if(target<0||target>=state.plan[day].length) return;
      [state.plan[day][i],state.plan[day][target]]=[state.plan[day][target],state.plan[day][i]];
    }
    changed(byId[code].name+' 방문 일정을 변경했습니다. 지도에 반영했습니다.');
    const focus=$('rp-itinerary').querySelector('[data-code="'+code+'"][data-action="'+change+'"]');
    if(focus && !focus.disabled) focus.focus({preventScroll:true});
  }
  function stopHTML(code,index,total,day) {
    const s=byId[code], planned=!!state.plan;
    return '<div class="rp-stop'+(planned?' rp-planned':'')+'"><span class="rp-stop-num">'+(planned?index+1:'✓')+'</span><div><button type="button" class="rp-stop-title" data-action="view" data-code="'+code+'">'+escape(s.name)+'<span class="rp-stop-city">'+escape(s.city)+'</span></button></div><div class="rp-stop-tools">'+(planned?'<button type="button" data-action="up" data-code="'+code+'" aria-label="'+escape(s.name)+' 순서 앞으로"'+(index===0?' disabled':'')+'>↑</button><button type="button" data-action="down" data-code="'+code+'" aria-label="'+escape(s.name)+' 순서 뒤로"'+(index===total-1?' disabled':'')+'>↓</button>'+(state.days===2?'<button type="button" data-action="day" data-code="'+code+'" aria-label="'+escape(s.name)+' '+(day===0?'2':'1')+'일차로 이동" title="다른 날로 이동">⇄</button>':''):'')+'<button type="button" class="rp-remove" data-action="remove" data-code="'+code+'" aria-label="'+escape(s.name)+' 선택 해제">×</button></div></div>';
  }
  function naverLinks(seq) {
    // Documented mobile URL scheme supports at most five waypoints.
    // Links are explicitly labelled as app links; no misleading last-stop web fallback.
    let html='';
    const count=Math.ceil((seq.length-1)/6);
    for(let start=0,part=1;start<seq.length-1;start+=6,part++) {
      const leg=seq.slice(start,Math.min(start+7,seq.length)),a=leg[0],b=leg[leg.length-1];
      const p=new URLSearchParams({slat:a.lat,slng:a.lng,sname:a.name,dlat:b.lat,dlng:b.lng,dname:b.name,appname:location.protocol==='file:'?'daegi.inspection':location.origin+location.pathname});
      leg.slice(1,-1).forEach((node,i)=>{p.set('v'+(i+1)+'lat',node.lat);p.set('v'+(i+1)+'lng',node.lng);p.set('v'+(i+1)+'name',node.name);});
      html+='<a href="nmap://route/car?'+escape(p.toString())+'" title="네이버지도 앱 필요">네이버 앱 길찾기'+(count>1?' '+part+'/'+count:'')+' ↗</a>';
    }
    return '<div class="rp-navigation">'+html+'</div>';
  }
  function renderItinerary() {
    const el=$('rp-itinerary');
    if(!state.selected.length) {
      el.innerHTML='<div class="rp-empty"><span class="rp-empty-icon" aria-hidden="true">＋</span><strong>방문할 곳을 지도에서 담아보세요</strong>측정소 점을 누르면 선택됩니다.<br>시군 영역을 누르면 일괄 선택할 수 있어요.</div>';
    } else if(!state.plan) el.innerHTML=state.selected.map((code,i)=>stopHTML(code,i,state.selected.length,0)).join('');
    else {
      const seqs=sequences();
      el.innerHTML=state.plan.map((codes,day)=>'<section class="'+(day===1?'rp-day-two':'rp-day-one')+'"><div class="rp-day-header"><span>'+(state.days===2?(day+1)+'일차':'당일 일정')+' · '+codes.length+'곳</span><small>직선 '+length(seqs[day]).toFixed(0)+' km</small></div><div class="rp-endpoint">'+escape(seqs[day][0].name)+' 출발</div>'+(codes.length?codes.map((code,i)=>stopHTML(code,i,codes.length,day)).join(''):'<div class="rp-day-empty">이 날의 방문 측정소가 없습니다.</div>')+'<div class="rp-endpoint">'+escape(seqs[day][seqs[day].length-1].name)+' 도착</div>'+naverLinks(seqs[day])+'</section>').join('');
    }
    $('rp-list-title').textContent=state.plan?'방문 순서 · 화살표로 조정':'선택한 측정소';
    $('rp-plan-note').textContent=state.plan?'점선과 번호는 방문 순서입니다. 도로 경로·소요시간은 네이버지도 앱에서 확인하세요. 이 일정은 현재 기기에 임시저장됩니다.':'방문할 곳을 담으면 순서를 추천해 드립니다. 이 일정은 현재 기기에 임시저장됩니다.';
  }
  function renderSettings() {
    $('rp-count').textContent=state.selected.length;
    $('rp-day-1').setAttribute('aria-pressed',state.days===1);
    $('rp-day-2').setAttribute('aria-pressed',state.days===2);
    $('rp-lodging').hidden=state.days!==2;
    $('rp-lodging-city').value=state.lodgingCity;
    $('rp-lodging-note').textContent=state.lodgingPoint?'지도에서 지정한 숙박 위치를 사용합니다.':'숙소 미지정 · '+state.lodgingCity+' 기준점 사용. 숙소를 정했다면 지도에서 위치를 지정하세요.';
    $('rp-lodging-reset').hidden=!state.lodgingPoint;
    $('rp-recommend').disabled=!state.selected.length;
    $('rp-recommend').textContent=state.plan?'방문 순서 다시 추천':(state.selected.length?state.selected.length+'곳 방문 순서 추천':'방문 순서 추천');
    $('rp-clear').disabled=!state.selected.length;
    $('rp-fit-selected').disabled=!state.selected.length;
    $('rp-legend-day1').textContent=state.plan?(state.days===2?'1일차':'방문 순서'):'선택';
    $('rp-legend-day2').hidden=!(state.plan&&state.days===2);
    $('rp-line-legend').hidden=!state.plan;
    $('rp-map-guide').textContent=state.plan?'번호: 방문 순서 · 묶음을 누르면 확대':'숫자는 측정소 수 · 누르면 확대';
  }
  function render() {
    if(!initialized) return;
    renderTrips();renderSettings();renderItinerary();renderDistricts();renderLines();renderMarkers();renderDetail();
    resizeMap();
  }
  function resizeMap() {
    if(!map||!$('page-route').classList.contains('active'))return;
    if(innerWidth>850) {
      const top=$('rp-map').getBoundingClientRect().top+scrollY;
      $('page-route').style.setProperty('--rp-map-height',Math.max(360,Math.min(700,innerHeight-top-110))+'px');
    } else {
      const top=$('rp-map').getBoundingClientRect().top+scrollY;
      $('page-route').style.setProperty('--rp-mobile-map-height',Math.max(300,Math.min(480,innerHeight-top-148))+'px');
    }
    map.invalidateSize({animate:false});
  }
  function search() {
    const value=$('rp-search').value.trim().replace(/\s/g,'').toLowerCase(), el=$('rp-search-results');
    el.hidden=!value;$('rp-search').setAttribute('aria-expanded',!!value);
    if(!value) return;
    const cities=Object.keys(byCity).filter(city=>city.includes(value));
    const stations=DATA.stations.filter(s=>(s.city+s.name+s.code).replace(/\s/g,'').toLowerCase().includes(value));
    el.innerHTML=cities.map(city=>'<button type="button" data-search-city="'+escape(city)+'"><span>'+escape(city)+'</span><small>측정소 '+byCity[city].length+'곳 · 지역 보기</small></button>').join('')+stations.map(s=>'<button type="button" data-search-code="'+s.code+'"><span>'+escape(s.name)+'</span><small>'+escape(s.city)+' · '+(selected(s.code)?'선택됨':'위치 보기')+'</small></button>').join('');
    if(!cities.length&&!stations.length) el.innerHTML='<p>일치하는 측정소나 시군이 없습니다.</p>';
  }
  function bindUI() {
    $('rp-trip-import').onclick=()=>$('rp-trip-file').click();
    $('rp-trip-file').onchange=event=>importTrips(event.target.files[0]);
    $('rp-trip-select').onchange=event=>chooseTrip(event.target.value);
    $('rp-fit').onclick=()=>{detailClose();setPicking(false);fitAll();};
    $('rp-fit-selected').onclick=()=>{detailClose();setPicking(false);fitSelected();};
    $('rp-roads').onclick=()=>{
      if(!roads && (location.protocol==='file:' || !navigator.onLine)) {announce('도로지도는 인터넷에 연결된 웹사이트에서 사용할 수 있습니다. 기본 측정소 지도는 계속 사용할 수 있습니다.');return;}
      roads=!roads;$('rp-roads').setAttribute('aria-pressed',roads);$('rp-roads').textContent=roads?'도로지도 켜짐':'도로지도';
      if(roads) {
        if(!roadLayer) {
          roadLayer=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',updateWhenIdle:true,keepBuffer:1});
          roadLayer.on('tileerror',()=>announce('일부 도로지도를 불러오지 못했습니다. 인터넷 연결을 확인하거나 도로지도를 끄세요.'));
        }
        map.removeLayer(neighborsLayer);roadLayer.addTo(map);announce('도로지도를 켰습니다. 점선은 실제 도로 경로가 아닌 방문 순서입니다.');
      } else {if(roadLayer)map.removeLayer(roadLayer);neighborsLayer.addTo(map);neighborsLayer.bringToBack();}
      renderDistricts();
    };
    $('rp-day-1').onclick=()=>days(1);$('rp-day-2').onclick=()=>days(2);
    $('rp-recommend').onclick=recommend;
    $('rp-show-base').onclick=()=>{detail={type:'base'};map.setView(coord(DATA.base),13,{animate:false});renderDetail();};
    $('rp-clear').onclick=()=>{state.selected=[];state.plan=null;detailClose();changed('방문지 선택을 비웠습니다.');};
    $('rp-pick-lodging').onclick=()=>setPicking(true);$('rp-pick-cancel').onclick=()=>setPicking(false);
    $('rp-lodging-reset').onclick=()=>{state.lodgingPoint=null;invalidate();changed('숙박 지역 기준점으로 변경했습니다.');};
    $('rp-lodging-city').onchange=event=>{state.lodgingCity=event.target.value;state.lodgingPoint=null;invalidate();setPicking(false);changed('숙박 지역을 변경했습니다.');};
    $('rp-panel-toggle').onclick=()=>{
      if(!matchMedia('(max-width:850px)').matches) return;
      const folded=$('rp-panel-toggle').getAttribute('aria-expanded')==='true';
      $('rp-panel-toggle').setAttribute('aria-expanded',!folded);$('rp-panel-body').hidden=folded;
      $('rp-panel-toggle').querySelector('.rp-fold-label').textContent=folded?'펼치기 ⌄':'접기 ⌃';
    };
    $('rp-itinerary').onclick=event=>{
      const b=event.target.closest('[data-action]');if(!b)return;
      if(b.dataset.action==='view') viewStation(b.dataset.code);
      else if(b.dataset.action==='remove') {toggleStation(b.dataset.code);detailClose();}
      else reorder(b.dataset.code,b.dataset.action);
    };
    $('rp-search').addEventListener('input',search);
    $('rp-search').addEventListener('focus',search);
    $('rp-search').addEventListener('keydown',event=>{
      if(event.key==='ArrowDown') {const first=$('rp-search-results').querySelector('button');if(first){event.preventDefault();first.focus();}}
      if(event.key==='Escape') {$('rp-search-results').hidden=true;$('rp-search').setAttribute('aria-expanded','false');}
    });
    $('rp-search-results').onclick=event=>{
      const b=event.target.closest('button');if(!b)return;
      if(b.dataset.searchCity) viewCity(b.dataset.searchCity);else if(b.dataset.searchCode) viewStation(b.dataset.searchCode);
      $('rp-search-results').hidden=true;$('rp-search').setAttribute('aria-expanded','false');$('rp-search').value='';
    };
    document.addEventListener('click',event=>{if(!event.target.closest('.rp-search-wrap')){$('rp-search-results').hidden=true;$('rp-search').setAttribute('aria-expanded','false');}});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('page-route').classList.contains('active')){setPicking(false);detailClose();}});
  }
  function open() {
    if(!DATA||!window.L) { $('rp-error').hidden=false;$('rp-error').textContent='지도를 불러오지 못했습니다. admin.html과 assets 폴더를 함께 업로드했는지 확인해 주세요.';return; }
    if(!initialized) {
      DATA.stations.forEach(s=>{byId[s.code]=s;(byCity[s.city]||(byCity[s.city]=[])).push(s);});
      restore();
      $('rp-lodging-city').innerHTML=Object.keys(byCity).map(city=>'<option>'+escape(city)+'</option>').join('');
      map=L.map('rp-map',{zoomControl:false,attributionControl:true,minZoom:7,maxZoom:16,zoomSnap:.25,zoomDelta:.75,preferCanvas:true,maxBounds:[[36.3,125.8],[39.4,130.7]],maxBoundsViscosity:.85});
      map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
      L.control.zoom({position:'topright',zoomInTitle:'확대',zoomOutTitle:'축소'}).addTo(map);
      neighborsLayer=L.geoJSON(DATA.neighbors,{style:{color:'#dce5e8',weight:.7,fillColor:'#e7edef',fillOpacity:1},interactive:false}).addTo(map);
      districts=L.geoJSON(DATA.boundaries,{style:{color:'#bacbd3',weight:1.1,fillColor:'#fcfdfd',fillOpacity:1},onEachFeature:(feature,layer)=>{
        layer.on('click',event=>{if(picking){pickPoint(event.latlng);return;}detail={type:'city',city:feature.properties.name};renderDetail();});
      }}).addTo(map);
      lineLayer=L.layerGroup().addTo(map);labelLayer=L.layerGroup().addTo(map);pointLayer=L.layerGroup().addTo(map);baseLayer=L.layerGroup().addTo(map);
      Object.entries(DATA.cities).forEach(([city,p])=>L.marker(coord(p.label),{icon:L.divIcon({className:'rp-district-label',html:escape(city),iconSize:[80,20],iconAnchor:[40,10]}),interactive:false,keyboard:false,zIndexOffset:-200}).addTo(labelLayer));
      resizeMap();fitAll();
      map.on('zoomend',()=>{renderMarkers();renderDistricts();});
      map.on('click',event=>{if(picking)pickPoint(event.latlng);});
      bindUI();initialized=true;render();
      window.addEventListener('resize',()=>requestAnimationFrame(resizeMap));
    }
    requestAnimationFrame(resizeMap);
  }
  window.RoutePlanner=Object.freeze({open});
})();
