(function(){
  const vp = document.getElementById('carouselViewport');
  if(!vp) return;

  /* ---------------- Player refs ---------------- */
  const playerEl = document.querySelector('.player');
  const playerBtn = document.querySelector('.player__btn');
  const playerTitleEl = document.getElementById('playerTitle');
  const playerAuthorEl = document.getElementById('playerAuthor');
  const playerCurrentTimeEl = document.getElementById('playerCurrentTime');
  const playerDurationEl = document.getElementById('playerDuration');
  const playerBarEl = document.getElementById('playerBar');
  const mainAudioPlayer = document.getElementById('mainAudioPlayer');

  const recordCtaBtn = document.querySelector('.record-btn');

  /* ---------------- Modals/Inputs (기존 그대로) ---------------- */
  const recordModal = document.getElementById('recordModal');
  const coverModal = document.getElementById('coverModal');
  const fromModal = document.getElementById('fromModal');
  const finalAlertModal = document.getElementById('finalAlertModal');
  const finalAlertTitle = document.getElementById('finalAlertTitle');
  const finalAlertCancelBtn = document.getElementById('finalAlertCancel');
  const finalAlertConfirmBtn = document.getElementById('finalAlertConfirm');
  const alertModal = document.getElementById('alertModal');
  const alertCancelBtn = document.getElementById('alertCancel');
  const alertConfirmBtn = document.getElementById('alertConfirm');

  const modalRecordBtn = document.querySelector('.record-btn-modal');
  const modalRecordIcon = document.getElementById('modalRecordIcon');
  const recipientInput = document.getElementById('recipientInput');
  const modalCancelBtn = document.getElementById('modalCancel');
  const modalNextBtn = document.getElementById('modalNext');
  const currentTimeEl = document.getElementById('currentTime');
  const recordedDurationEl = document.getElementById('recordedDuration');
  const progressFillEl = document.getElementById('recordProgressFill');

  const coverModalCancelBtn = document.getElementById('coverModalCancel');
  const coverModalNextBtn = document.getElementById('coverModalNext');
  const imageOptions = document.querySelectorAll('.image-option');
  const finalCoverPreview = document.getElementById('finalCoverPreview');
  const webcamStreamEl = document.getElementById('webcamStream');
  const webcamCanvas = document.getElementById('webcamCanvas');
  const webcamPlaceholder = document.getElementById('webcamPlaceholder');
  const captureBtn = document.getElementById('captureBtn');

  const senderInput = document.getElementById('senderInput');
  const fromModalCancelBtn = document.getElementById('fromModalCancel');
  const fromModalSendBtn = document.getElementById('fromModalSend');

  /* ---------------- Recording state ---------------- */
  const maxRecordTime = 60;
  let recorder = null;
  let audioChunks = [];
  let audioBlob = null;
  let mediaStream = null;
  let recordingTimer = null;
  let recordedTimeSeconds = 0;
  let selectedCoverSrc = null;
  let webcamStream = null;
  let isPreviewing = false;
  let isRecording = false;

  /* ---------------- Timeline & Layout ----------------
     - timeline: 최신순 배열(0 = 최신, 1 = 직전, 2 = 그다음 …)
     - centerIndex: 현재 중앙에 올 timeline의 인덱스(기본 0 = 최신)
     - 화면 배치는 "중앙 0"을 기준으로 왼쪽에 1,2,3…을 채우고,
       균형 맞춤을 위해 오른쪽에도 같은 규칙으로 번갈아 배치.
  ---------------------------------------------------- */
  let timeline = [];     // DOM nodes
  let centerIndex = 0;   // 0 = 최신
  let ghostEl = null;

  /* ---------- Utils ---------- */
  function formatTime(s){
    const m = Math.floor(s/60);
    const r = Math.floor(s%60);
    return `${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`;
  }

  function updatePlayerUI(card) {
    const title = card.querySelector('.vcard__title')?.textContent || '';
    const author = card.querySelector('.vcard__meta')?.textContent || '';
    const duration = parseInt(card.dataset.duration || 0, 10);
    const audioUrl = card.dataset.audioSrc || '';

    if (mainAudioPlayer.src !== audioUrl) {
      mainAudioPlayer.src = audioUrl;
      mainAudioPlayer.load();
    }
    playerTitleEl.textContent = title;
    playerAuthorEl.textContent = author;
    playerDurationEl.textContent = formatTime(duration);
    playerCurrentTimeEl.textContent = '00:00';
    playerBarEl.style.width = '0%';
    playerEl.setAttribute('aria-valuenow', 0);

    playerBtn.textContent = '▶';
    playerEl.classList.remove('is-playing');
    timeline.forEach(c=>c.classList?.remove('is-playing'));
  }

  function stopPlayback() {
    mainAudioPlayer.pause();
    mainAudioPlayer.currentTime = 0;
    playerBtn.textContent = '▶';
    playerEl.classList.remove('is-playing');
    playerCurrentTimeEl.textContent = '00:00';
    playerBarEl.style.width = '0%';
    playerEl.setAttribute('aria-valuenow', 0);
    timeline.forEach(c=>c.classList?.remove('is-playing'));
  }

  /* ---------- 초기 timeline 구성 ----------
     현재 DOM에서 중앙(aria-current 또는 .vcard--active)을 찾고,
     그 카드를 최신(0)으로 가정한 뒤, 왼쪽→오른쪽 순으로 오래된 순서대로 붙임.
  --------------------------------------- */
  function buildInitialTimeline(){
    const domCards = Array.from(vp.querySelectorAll('.vcard'))
      .filter(el=>!el.classList.contains('vcard--ghost'));
    if(domCards.length===0) return;

    let center = domCards.find(el=>el.hasAttribute('aria-current')) ||
                 domCards.find(el=>el.classList.contains('vcard--active')) ||
                 domCards[Math.floor(domCards.length/2)];

    // 왼쪽(이전 형제들: 화면상 왼쪽에 있는 카드들) → 최근 바로 이전으로 취급
    const left = [];
    let p = center.previousElementSibling;
    while(p && p.classList.contains('vcard')){
      left.push(p);
      p = p.previousElementSibling;
    }
    // 오른쪽(다음 형제들)
    const right = [];
    let n = center.nextElementSibling;
    while(n && n.classList.contains('vcard')){
      right.push(n);
      n = n.nextElementSibling;
    }
    // 최신순 배열 만들기: [center, ...left(좌측에서 가까운 순), ...right]
    timeline = [center, ...left, ...right];
    centerIndex = 0; // 중앙을 최신으로 설정
  }

  /* ---------- 균형(홀수) 유지용 고스트 ---------- */
  function ensureOddCount(){
    const currentCount = timeline.length;
    const needGhost = currentCount % 2 === 0; // 짝수면 고스트 필요
    if(needGhost && !ghostEl){
      ghostEl = document.createElement('article');
      ghostEl.className = 'vcard vcard--ghost';
      ghostEl.setAttribute('aria-hidden','true');
      vp.appendChild(ghostEl);
    }else if(!needGhost && ghostEl){
      ghostEl.remove();
      ghostEl = null;
    }
  }

  /* ---------- 레이아웃 렌더 ----------
     시각 순서를 '왼쪽(오래됨) → 중앙(최신) → 오른쪽(조금 더 오래됨)'으로 구성.
     중앙은 timeline[centerIndex].
     왼쪽은 centerIndex+1, +2, +3 … (중앙에서 멀수록 더 오래됨)
     오른쪽도 같은 집합을 번갈아 배치해 좌우 균형 유지.
  ----------------------------------- */
  function render(isAnimated = false){ // <-- isAnimated 인수를 추가
    ensureOddCount();

    // 중앙 기준으로 좌우 분해
    const leftSeq = [];   // 중앙 왼쪽에 놓일 순서 (직전, 그다음, …)
    const rightSeq = [];  // 중앙 오른쪽
    for(let i=centerIndex+1; i<timeline.length; i++){
      const step = i-(centerIndex); // 1,2,3…
      // 번갈아 배치: 홀수는 왼쪽, 짝수는 오른쪽
      if(step % 2 === 1) leftSeq.push(timeline[i]);
      else rightSeq.push(timeline[i]);
    }

    // DOM 순서: (왼쪽 역순) + [중앙] + (오른쪽)
    const order = [...leftSeq.slice().reverse(), timeline[centerIndex], ...rightSeq];

    // 고스트가 있으면 끝에 추가(시각 균형)
    vp.innerHTML = '';
    order.forEach(el=> vp.appendChild(el));
    if(ghostEl) vp.appendChild(ghostEl);

    // ********** 부드러운 애니메이션을 위한 transition 제어 로직 추가 **********
    if(isAnimated){
      // 애니메이션이 필요한 경우, 잠시 transition 속성을 추가
      timeline.forEach(c => c.style.transition = 'opacity 0.4s ease-out, transform 0.4s cubic-bezier(.68,-.55,.27,1.55)'); // transition 커브 변경
    } else {
      // 즉시 배치가 필요한 경우(초기 로딩, 리사이즈), transition을 제거
      vp.style.transition = 'none';
      timeline.forEach(c => c.style.transition = 'none');
    }
    // ********** 추가된 로직 끝 **********

    applyVisualStates(order);

    // ********** 애니메이션 종료 후 transition 제거 로직 추가 **********
    if(isAnimated){
      setTimeout(()=>{
        timeline.forEach(c => c.style.transition = 'none');
      }, 420); // 애니메이션 시간(0.4s)보다 조금 더 길게
    }
    // ********** 추가된 로직 끝 **********
  }

  /* ---------- 시각 스타일 적용 (애니메이션 효과 극대화) ----------
     요구사항:
       - 비중앙 카드 크기 동일(스케일 1)
       - 중앙 카드만 큰 사이즈
       - 간격은 gap으로만
       - 오퍼시티: 중앙에서 멀수록 감소
  ------------------------------------- */
  function applyVisualStates(order){
    const centerPos = order.indexOf(timeline[centerIndex]);

    order.forEach((el, i)=>{
      const isCenter = (i === centerPos) && !el.classList.contains('vcard--ghost');
      const d = Math.abs(i - centerPos);   // 중앙에서의 시각 거리

      // 크기/클래스
      if(isCenter){
        el.classList.add('vcard--center');
        el.removeAttribute('aria-hidden');
        el.setAttribute('aria-current','true');
      }else{
        el.classList.remove('vcard--center');
        el.removeAttribute('aria-current');
        // 너무 먼 카드는 스크린리더 제외(옵션)
        el.setAttribute('aria-hidden', d>=6 || el.classList.contains('vcard--ghost') ? 'true' : 'false');
      }

      // ✅ 스케일 및 translateY 조정 (애니메이션 효과 극대화)
      let scaleValue = 1;
      let translateYValue = '0';
      if(isCenter) {
          scaleValue = 1.05; // 중앙 카드의 크기 (CSS로 제어되는 vcard--center 크기와 별개로, 미세 조정)
          translateYValue = '0';
      } else {
          // 비중앙 카드는 작게 만들고, 멀수록 더 아래로 내려 입체감 부여
          scaleValue = 0.95; // 0.95로 줄여서 중앙 카드와의 차이를 극대화
          translateYValue = `${d * 3 + 4}px`; // 중앙에서 멀수록 4px, 7px, 10px...
      }
      
      el.style.transform = `scale(${scaleValue}) translateY(${translateYValue})`; 

      // ✅ 오퍼시티 감쇠 (원하면 계수만 조정)
      const opacity = Math.max(0.18, 1 - d*0.22); // 1, 0.78, 0.56, 0.34, 0.18…
      el.style.opacity = el.classList.contains('vcard--ghost') ? '0' : String(opacity);

      // z-index는 중앙 우선
      el.style.zIndex = String(100 - d);
    });

    // 플레이어 메타(중앙 기준)
    const centerCard = timeline[centerIndex];
    if(centerCard && !centerCard.classList.contains('vcard--ghost')){
      updatePlayerUI(centerCard);
    }
  }

  /* ---------- 네비게이션 ---------- */
  function snapTo(index){
    // 범위 클램프: 0(최신) ~ timeline.length-1(가장 오래된)
    const newIndex = Math.max(0, Math.min(index, timeline.length - 1));
    if(newIndex === centerIndex) return; // 같은 위치면 이동 안 함

    centerIndex = newIndex;
    stopPlayback();
    render(true); // <-- 애니메이션 활성화 (true)
  }

  // 좌/우 화살표: 좌(older) = +1, 우(newer) = -1
  document.querySelectorAll('.cta-arrow').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const dir = Number(btn.dataset.dir || 1);
      if(dir>0) snapTo(centerIndex + 1); // older
      else snapTo(centerIndex - 1);      // newer
    });
  });

  // 카드 클릭: 해당 카드를 중앙으로
  vp.addEventListener('click', (e)=>{
    const card = e.target.closest('.vcard');
    if(!card || card.classList.contains('vcard--ghost')) return;

    const idx = timeline.indexOf(card);
    if(idx === -1) return;

    if(idx === centerIndex){
      // 중앙 카드에서 pill 클릭이면 재생 토글
      if(e.target.closest('.pill')) toggleMainPlayback();
      return;
    }
    snapTo(idx);
  });

  /* ---------- 플레이 토글(항상 중앙 기준) ---------- */
  function toggleMainPlayback(){
    const centerCard = timeline[centerIndex];
    if(!centerCard || centerCard.classList.contains('vcard--ghost')) return;
    const src = centerCard.dataset.audioSrc;
    if(!src) return;

    if (mainAudioPlayer.src !== src) updatePlayerUI(centerCard);

    if (mainAudioPlayer.paused) {
      mainAudioPlayer.play().catch(console.error);
      playerBtn.textContent = '||';
      playerEl.classList.add('is-playing');
      centerCard.classList.add('is-playing');
    } else {
      mainAudioPlayer.pause();
      playerBtn.textContent = '▶';
      playerEl.classList.remove('is-playing');
      centerCard.classList.remove('is-playing');
    }
  }
  playerBtn?.addEventListener('click', toggleMainPlayback);

  mainAudioPlayer.addEventListener('timeupdate', () => {
    const currentTime = mainAudioPlayer.currentTime;
    const duration = mainAudioPlayer.duration || 0;
    const progress = (duration > 0) ? (currentTime / duration) * 100 : 0;
    playerCurrentTimeEl.textContent = formatTime(currentTime);
    playerBarEl.style.width = `${progress}%`;
    playerEl.setAttribute('aria-valuenow', Math.round(progress));
  });
  mainAudioPlayer.addEventListener('ended', ()=>{
    mainAudioPlayer.pause();
    mainAudioPlayer.currentTime = 0;
    playerBtn.textContent = '▶';
    playerEl.classList.remove('is-playing');
    timeline[centerIndex]?.classList?.remove('is-playing');
  });

  /* ---------------- 녹음/모달 부분: 기존 로직 유지 ----------------
     아래 addCard(data)만 새 규칙에 맞게 수정
  -------------------------------------------------------------- */
  function stopPreviewPlayback() {
    mainAudioPlayer.pause();
    mainAudioPlayer.currentTime = 0;
    modalRecordIcon.src = './assets/images/play.png';
    currentTimeEl.textContent = '00:00';
    progressFillEl.style.width = '0%';
    isPreviewing = false;
  }
  function resetRecordModal(){
    if(recordingTimer) clearInterval(recordingTimer);
    if(recorder && recorder.state !== 'inactive') recorder.stop();
    isRecording = false;
    audioBlob = null;
    audioChunks = [];
    recordedTimeSeconds = 0;
    isPreviewing = false;

    recipientInput.value = '';
    modalRecordIcon.src = './assets/images/play.png';
    modalNextBtn.disabled = true;
    currentTimeEl.textContent = '00:00';
    recordedDurationEl.textContent = '00:00';
    progressFillEl.style.width = '0%';

    mainAudioPlayer.src = '';
    mainAudioPlayer.load();
  }

  function formatBlobDuration(blob){
    return new Promise((res)=>{
      const tmp = new Audio(URL.createObjectURL(blob));
      tmp.addEventListener('loadedmetadata', ()=>{
        res(Math.round(tmp.duration || 0));
      });
    });
  }

  async function startWebcam(){
    if(webcamStream) return;
    try{
      webcamStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'user' } });
      webcamStreamEl.srcObject = webcamStream;
      webcamStreamEl.style.display = 'block';
      webcamPlaceholder.style.display = 'none';
      webcamCanvas.style.display = 'none';
      captureBtn.style.display = 'flex';
    }catch(e){
      console.error('웹캠 접근 오류:', e);
      webcamPlaceholder.alt = '웹캠을 켤 수 없습니다.';
    }
  }
  function stopWebcam(){
    if(webcamStream){
      webcamStream.getTracks().forEach(t=>t.stop());
      webcamStream = null;
    }
    webcamStreamEl.srcObject = null;
    webcamStreamEl.style.display = 'none';
    webcamPlaceholder.style.display = 'block';
    webcamCanvas.style.display = 'none';
    captureBtn.style.display = 'flex';
  }
  function captureImage(){
    if(!webcamStream || webcamStreamEl.style.display==='none') return null;
    const W = webcamStreamEl.videoWidth;
    const H = webcamStreamEl.videoHeight;
    const S = Math.min(W,H);
    const sx = (W - S)/2, sy = (H - S)/2;
    webcamCanvas.width = S; webcamCanvas.height = S;
    const ctx = webcamCanvas.getContext('2d');
    ctx.drawImage(webcamStreamEl, sx, sy, S, S, 0, 0, S, S);
    const dataUrl = webcamCanvas.toDataURL('image/png');
    webcamStreamEl.style.display = 'none';
    webcamCanvas.style.display = 'block';
    return dataUrl;
  }

  function resetCoverModal(){
    selectedCoverSrc = null;
    coverModalNextBtn.disabled = true;
    finalCoverPreview.style.backgroundImage = 'none';
    imageOptions.forEach(opt => opt.classList.remove('selected'));
    const def = document.querySelector('.image-option[data-src="./assets/images/sample1.png"]');
    if(def){
      def.classList.add('selected');
      selectedCoverSrc = def.dataset.src;
      finalCoverPreview.style.backgroundImage = `url('${selectedCoverSrc}')`;
      coverModalNextBtn.disabled = false;
    }
    stopWebcam();
  }
  function resetFromModal(){
    senderInput.value = '';
    fromModalSendBtn.disabled = true;
  }

  // 모달 오픈
  recordCtaBtn?.addEventListener('click', async ()=>{
    recordModal?.classList.add('is-active');
    document.body.style.overflow = 'hidden';
    resetRecordModal();
    stopPlayback();
    try{
      if (!mediaStream) mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      modalRecordBtn.disabled = true === false;
    }catch(e){
      alert("마이크 접근이 필요합니다. 설정을 확인해주세요.");
      modalRecordBtn.disabled = true;
    }
  });

  function startRecording() {
    if (!mediaStream) return;
    stopPlayback(); stopPreviewPlayback();
    isRecording = true;
    recordedTimeSeconds = 0;
    modalRecordIcon.src = './assets/images/record.png';
    modalNextBtn.disabled = true;
    recordedDurationEl.textContent = formatTime(maxRecordTime);

    const mimeType = MediaRecorder.isTypeSupported('audio/webm; codecs=opus') ? 'audio/webm; codecs=opus' : 'audio/webm';
    try { recorder = new MediaRecorder(mediaStream, { mimeType }); }
    catch { recorder = new MediaRecorder(mediaStream); }

    audioChunks = [];
    recorder.ondataavailable = e => { if(e.data.size>0) audioChunks.push(e.data); };
    recorder.onstop = async () => {
      const finalType = audioChunks[0]?.type || 'audio/webm';
      audioBlob = new Blob(audioChunks, { type: finalType });
      recordedTimeSeconds = await formatBlobDuration(audioBlob);
      recordedDurationEl.textContent = formatTime(recordedTimeSeconds);
      modalRecordIcon.src = './assets/images/play.png';
      progressFillEl.style.width = '0%';
      currentTimeEl.textContent = '00:00';
      modalNextBtn.disabled = recordedTimeSeconds < 1;
    };

    recorder.start();
    recordingTimer = setInterval(()=>{
      recordedTimeSeconds++;
      currentTimeEl.textContent = formatTime(recordedTimeSeconds);
      progressFillEl.style.width = `${(recordedTimeSeconds / maxRecordTime) * 100}%`;
      if(recordedTimeSeconds >= maxRecordTime) stopRecording();
    },1000);
  }
  function stopRecording(){
    if (!isRecording || !recorder || recorder.state === 'inactive') return;
    if (recordingTimer) clearInterval(recordingTimer);
    isRecording = false;
    if (recorder.state === 'recording') recorder.stop();
  }
  function toggleRecordPlayback(){
    if (isRecording) { stopRecording(); return; }
    if (audioBlob){
      if (mainAudioPlayer.paused || !isPreviewing) {
        const url = URL.createObjectURL(audioBlob);
        if (mainAudioPlayer.src !== url){ mainAudioPlayer.src = url; mainAudioPlayer.load(); }
        const onTime = () => {
          const cur = mainAudioPlayer.currentTime;
          const dur = mainAudioPlayer.duration || recordedTimeSeconds;
          const p = (dur>0) ? (cur/dur)*100 : 0;
          currentTimeEl.textContent = formatTime(cur);
          progressFillEl.style.width = `${p}%`;
        };
        const onEnd = ()=>{
          stopPreviewPlayback();
          mainAudioPlayer.removeEventListener('timeupdate', onTime);
          mainAudioPlayer.removeEventListener('ended', onEnd);
        };
        mainAudioPlayer.addEventListener('timeupdate', onTime);
        mainAudioPlayer.addEventListener('ended', onEnd);
        mainAudioPlayer.play().then(()=>{ modalRecordIcon.src='./assets/images/record.png'; isPreviewing = true; })
          .catch(()=>{ modalRecordIcon.src='./assets/images/play.png'; isPreviewing=false; });
      } else {
        stopPreviewPlayback();
      }
    } else {
      startRecording();
    }
  }
  modalRecordBtn?.addEventListener('click', toggleRecordPlayback);

  // 취소 -> 경고
  modalCancelBtn?.addEventListener('click', ()=> alertModal?.classList.add('is-active'));
  alertCancelBtn?.addEventListener('click', ()=> alertModal?.classList.remove('is-active'));
  alertConfirmBtn?.addEventListener('click', ()=>{
    alertModal?.classList.remove('is-active');
    recordModal?.classList.remove('is-active');
    document.body.style.overflow = '';
    stopPlayback(); stopPreviewPlayback(); resetRecordModal(); resetCoverModal(); resetFromModal();
    if (mediaStream) { mediaStream.getTracks().forEach(t=>t.stop()); mediaStream=null; }
  });
  recordModal?.addEventListener('click', (e)=>{
    if(e.target === recordModal){
      if(isRecording) stopRecording();
      if(isPreviewing) stopPreviewPlayback();
      alertModal?.classList.add('is-active');
    }
  });

  // record -> cover
  modalNextBtn?.addEventListener('click', ()=>{
    if(modalNextBtn.disabled) return;
    recordModal?.classList.remove('is-active');
    coverModal?.classList.add('is-active');
    resetCoverModal();
    startWebcam();
  });

  // cover picks
  imageOptions.forEach(option=>{
    option.addEventListener('click', ()=>{
      imageOptions.forEach(o=>o.classList.remove('selected'));
      webcamCanvas?.classList.remove('selected');
      option.classList.add('selected');
      selectedCoverSrc = option.dataset.src;
      finalCoverPreview.style.backgroundImage = `url('${selectedCoverSrc}')`;
      coverModalNextBtn.disabled = false;
    });
  });
  captureBtn?.addEventListener('click', (e)=>{
    e.preventDefault();
    const img = captureImage();
    if(img){
      imageOptions.forEach(opt=>opt.classList.remove('selected'));
      webcamCanvas.classList.add('selected');
      selectedCoverSrc = img;
      finalCoverPreview.style.backgroundImage = `url('${selectedCoverSrc}')`;
      coverModalNextBtn.disabled = false;
    }
  });
  webcamCanvas?.addEventListener('click', ()=>{
    if(webcamCanvas.style.display==='block'){
      imageOptions.forEach(opt=>opt.classList.remove('selected'));
      webcamCanvas.classList.add('selected');
      selectedCoverSrc = webcamCanvas.toDataURL('image/png');
      finalCoverPreview.style.backgroundImage = `url('${selectedCoverSrc}')`;
      coverModalNextBtn.disabled = false;
    }
  });
  coverModalCancelBtn?.addEventListener('click', ()=>{
    stopWebcam();
    coverModal?.classList.remove('is-active');
    recordModal?.classList.add('is-active');
  });

  // cover -> from
  coverModalNextBtn?.addEventListener('click', ()=>{
    if(coverModalNextBtn.disabled) return;
    coverModal?.classList.remove('is-active');
    fromModal?.classList.add('is-active');
    resetFromModal();
  });

  // from
  senderInput?.addEventListener('input', ()=>{
    fromModalSendBtn.disabled = senderInput.value.trim() === '';
  });
  fromModalCancelBtn?.addEventListener('click', ()=>{
    fromModal?.classList.remove('is-active');
    coverModal?.classList.add('is-active');
  });
  fromModalSendBtn?.addEventListener('click', ()=>{
    if(fromModalSendBtn.disabled || !recipientInput.value || !senderInput.value) return;
    finalAlertTitle.textContent = `${recipientInput.value}님께 목소리를 전달할까요?`;
    fromModal?.classList.remove('is-active');
    finalAlertModal?.classList.add('is-active');
  });

  // 최종 전송
  finalAlertCancelBtn?.addEventListener('click', ()=>{
    finalAlertModal?.classList.remove('is-active');
    fromModal?.classList.add('is-active');
  });
  finalAlertConfirmBtn?.addEventListener('click', async ()=>{
    if(!audioBlob) return;
    finalAlertModal?.classList.remove('is-active');
    document.body.style.overflow = '';

    const localData = {
      title: `${recipientInput.value}에게 전하는 보이스`,
      author: senderInput.value,
      imageUrl: selectedCoverSrc,
      audioUrl: URL.createObjectURL(audioBlob),
      duration: recordedTimeSeconds
    };
    addCard(localData);

    stopPlayback(); stopPreviewPlayback();
    resetRecordModal(); resetCoverModal(); resetFromModal();
    if (mediaStream) { mediaStream.getTracks().forEach(t=>t.stop()); mediaStream=null; }
  });

  /* ---------- 새 카드 추가: 최신=중앙, 직전은 왼쪽 1칸 ---------- */
  function addCard(data){
    const el = document.createElement('article');
    el.className = 'vcard';
    el.setAttribute('tabindex','0');
    el.dataset.audioSrc = data.audioUrl || '';
    el.dataset.duration = data.duration || '0';

    el.innerHTML = `
      <header class="vcard__header">
        <h3 class="vcard__title">${data.title || ''}</h3>
        <small class="vcard__meta">${data.author || ''}</small>
      </header>
      <div class="vcard__media" style="background-image:url('${data.imageUrl || ''}')"></div>
      <button class="pill" type="button">보이스 듣기</button>
    `;

    // ✅ 최신을 맨 앞에 삽입(녹음 순서 유지: 왼쪽으로 밀려감)
    timeline.unshift(el);

    // DOM에는 렌더에서 재배치
    // 중앙은 항상 최신(0)
    centerIndex = 0;
    render(true); // 새 카드 추가 시에도 애니메이션 활성화

    // 살짝 등장 애니메이션 (새로운 카드가 나타날 때의 효과)
    requestAnimationFrame(()=>{
      // render()에서 전체 transition을 줬지만, 새 카드의 경우 이 효과를 덮어씌워서 잠시 사용
      el.style.transition = 'transform .4s cubic-bezier(.68,-.55,.27,1.55), opacity .4s';
      el.style.transform = 'scale(1.04) translateY(-3px)';
      el.style.opacity = '0';
      requestAnimationFrame(()=>{
        // render()에서 적용된 최종 스타일로 되돌아가기
        el.style.transform = '';
        el.style.opacity = '';
      });
    });
  }

  /* ---------- 초기화 ---------- */
  buildInitialTimeline();
  render(); // 초기 로딩 시에는 애니메이션 없이 렌더
  window.addEventListener('resize', ()=> render()); // 리사이즈 시에도 애니메이션 없이 즉시 렌더
})();