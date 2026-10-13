"use strict";

// LA HUELLA DE TU VOZ
// Prototipo interactivo de comunicación pública de la ciencia.
// Las medidas acústicas son exploratorias.
// No realiza identificación biométrica ni diagnósticos.

const $ = (id) => document.getElementById(id);

const recordBtn = $("recordBtn");
const stopBtn = $("stopBtn");
const demoBtn = $("demoBtn");
const statusMessage = $("statusMessage");
const recordingStatus = $("recordingStatus");
const timer = $("timer");
const audioPlayback = $("audioPlayback");
const results = $("resultados");
const demoNotice = $("demoNotice");

const waveCanvas = $("waveCanvas");
const resultWaveCanvas = $("resultWaveCanvas");
const fingerprintCanvas = $("fingerprintCanvas");

let audioContext = null;
let analyser = null;
let mediaStream = null;
let mediaRecorder = null;
let recognition = null;
let recordingChunks = [];
let animationId = null;
let timerInterval = null;
let recordingStart = 0;
let durationSeconds = 0;
let transcriptText = "";
let amplitudeSamples = [];
let energySamples = [];
let isRecording = false;
let playbackURL = null;
let sessionNumber = 0;

const MAX_SECONDS = 60;

const DEMO_TEXT =
	"Recuerdo un lugar cerca del mar. Me gusta caminar " +
	"por la playa y escuchar las olas. Allí compartí " +
	"momentos especiales con mi familia y mis amigos. " +
	"El sonido del agua me trae recuerdos de tranquilidad.";

const STOP_WORDS = new Set([
	"a","al","algo","ante","con","como","de","del","desde",
	"donde","el","ella","en","entre","era","es","esa","ese",
	"esta","este","esto","fue","ha","hay","la","las","le",
	"lo","los","me","mi","mis","muy","no","nos","o","para",
	"pero","por","que","se","si","sin","su","sus","te",
	"tu","un","una","uno","y","ya","yo","más","también",
	"cuando","porque","sobre","allí","aquí"
]);

function setStatus(message, label = "LISTO", recording = false) {
	statusMessage.textContent = message;
	recordingStatus.textContent = label;
	recordingStatus.classList.toggle("is-recording", recording);
}

function formatTime(seconds) {
	const value = Math.max(0, Math.floor(seconds));
	return (
		String(Math.floor(value / 60)).padStart(2, "0") +
		":" +
		String(value % 60).padStart(2, "0")
	);
}

function setupCanvas(canvas) {
	const ctx = canvas.getContext("2d");
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	const width = canvas.clientWidth || canvas.width;
	const height = canvas.clientHeight || 240;

	canvas.width = Math.round(width * dpr);
	canvas.height = Math.round(height * dpr);
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

	return { ctx, width, height };
}

function drawWave(canvas, samples, active = false) {
	const { ctx, width, height } = setupCanvas(canvas);

	ctx.clearRect(0, 0, width, height);
	ctx.fillStyle = "#071827";
	ctx.fillRect(0, 0, width, height);

	const middle = height / 2;

	ctx.strokeStyle = "rgba(120,180,210,.16)";
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(0, middle);
	ctx.lineTo(width, middle);
	ctx.stroke();

	if (!samples.length) {
		ctx.strokeStyle = "#53e1cc";
		ctx.lineWidth = 2;
		ctx.beginPath();

		for (let x = 0; x < width; x++) {
			const envelope =
				Math.sin(Math.PI * x / Math.max(width, 1)) * 0.25;

			const y =
				middle +
				Math.sin(x * 0.045) *
				Math.sin(x * 0.013) *
				height *
				envelope;

			if (x === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}

		ctx.stroke();
		return;
	}

	const barCount = Math.min(140, samples.length);
	const step = samples.length / barCount;
	const barWidth = width / barCount;

	for (let i = 0; i < barCount; i++) {
		const start = Math.floor(i * step);
		const end = Math.max(start + 1, Math.floor((i + 1) * step));

		let peak = 0;

		for (let j = start; j < end && j < samples.length; j++) {
			peak = Math.max(peak, Math.abs(samples[j]));
		}

		const amplitude = Math.min(1, peak);
		const barHeight = Math.max(3, amplitude * height * 0.82);

		const gradient = ctx.createLinearGradient(
			0, middle - barHeight / 2,
			0, middle + barHeight / 2
		);

		gradient.addColorStop(0, "#68a9ff");
		gradient.addColorStop(0.5, "#53e1cc");
		gradient.addColorStop(1, "#b39aff");

		ctx.fillStyle = gradient;
		ctx.fillRect(
			i * barWidth + 1,
			middle - barHeight / 2,
			Math.max(2, barWidth - 2),
			barHeight
		);
	}

	if (active) {
		ctx.fillStyle = "#53e1cc";
		ctx.beginPath();
		ctx.arc(width - 13, 15, 5, 0, Math.PI * 2);
		ctx.fill();
	}
}

function animateLiveWave() {
	if (!isRecording || !analyser) return;

	const data = new Float32Array(analyser.fftSize);
	analyser.getFloatTimeDomainData(data);

	let sumSquares = 0;
	let peak = 0;

	for (let i = 0; i < data.length; i++) {
		const value = data[i];
		sumSquares += value * value;
		peak = Math.max(peak, Math.abs(value));
	}

	const rms = Math.sqrt(sumSquares / data.length);

	amplitudeSamples.push(Math.min(1, peak));
	energySamples.push(rms);

	if (amplitudeSamples.length > 1200) {
		amplitudeSamples.shift();
		energySamples.shift();
	}

	drawWave(waveCanvas, Array.from(data), true);
	animationId = requestAnimationFrame(animateLiveWave);
}

function startSpeechRecognition() {
	const SpeechRecognition =
		window.SpeechRecognition || window.webkitSpeechRecognition;

	if (!SpeechRecognition) {
		return false;
	}

	try {
		recognition = new SpeechRecognition();
		recognition.lang = "es-CL";
		recognition.continuous = true;
		recognition.interimResults = true;

		let finalText = "";

		recognition.onresult = (event) => {
			let interimText = "";

			for (let i = event.resultIndex; i < event.results.length; i++) {
				const segment = event.results[i][0].transcript;

				if (event.results[i].isFinal) {
					finalText += segment + " ";
				} else {
					interimText += segment + " ";
				}
			}

			transcriptText = (finalText + interimText).trim();
		};

		recognition.onerror = (event) => {
			console.warn("Reconocimiento de voz:", event.error);
		};

		recognition.start();
		return true;
	} catch (error) {
		console.warn("Transcripción no disponible:", error);
		recognition = null;
		return false;
	}
}

async function startRecording() {
	if (isRecording) return;

	if (!navigator.mediaDevices?.getUserMedia) {
		setStatus(
			"Este navegador no permite grabar aquí. " +
			"Puedes explorar el modo demostración.",
			"NO DISPONIBLE"
		);
		return;
	}

	try {
		sessionNumber++;
		transcriptText = "";
		amplitudeSamples = [];
		energySamples = [];
		recordingChunks = [];
		durationSeconds = 0;

		if (playbackURL) {
			URL.revokeObjectURL(playbackURL);
			playbackURL = null;
		}

		audioPlayback.hidden = true;
		audioPlayback.removeAttribute("src");
		results.hidden = true;

		mediaStream = await navigator.mediaDevices.getUserMedia({
			audio: {
				echoCancellation: true,
				noiseSuppression: true
			}
		});

		audioContext = new (
			window.AudioContext || window.webkitAudioContext
		)();

		await audioContext.resume();

		const source = audioContext.createMediaStreamSource(mediaStream);
		analyser = audioContext.createAnalyser();
		analyser.fftSize = 2048;
		source.connect(analyser);

		const preferredMime = [
			"audio/webm;codecs=opus",
			"audio/webm",
			"audio/mp4"
		].find(type => MediaRecorder.isTypeSupported(type));

		mediaRecorder = preferredMime
			? new MediaRecorder(mediaStream, { mimeType: preferredMime })
			: new MediaRecorder(mediaStream);

		mediaRecorder.ondataavailable = (event) => {
			if (event.data.size > 0) recordingChunks.push(event.data);
		};

		mediaRecorder.onstop = () => {
			if (!recordingChunks.length) return;

			const blob = new Blob(recordingChunks, {
				type: mediaRecorder.mimeType || "audio/webm"
			});

			playbackURL = URL.createObjectURL(blob);
			audioPlayback.src = playbackURL;
			audioPlayback.hidden = false;
		};

		mediaRecorder.start(250);
		isRecording = true;
		recordingStart = performance.now();

		recordBtn.disabled = true;
		stopBtn.disabled = false;
		demoBtn.disabled = true;

		timer.textContent = "00:00";

		const recognitionAvailable = startSpeechRecognition();

		setStatus(
			recognitionAvailable
				? "Grabando. Habla con naturalidad."
				: "Grabando audio. La transcripción no está disponible " +
					"en este navegador.",
			"GRABANDO",
			true
		);

		animateLiveWave();

		timerInterval = setInterval(() => {
			durationSeconds = Math.min(
				MAX_SECONDS,
				(performance.now() - recordingStart) / 1000
			);

			timer.textContent = formatTime(durationSeconds);

			if (durationSeconds >= MAX_SECONDS) {
				stopRecording();
			}
		}, 100);

	} catch (error) {
		console.error(error);

		if (mediaStream) {
			mediaStream.getTracks().forEach(track => track.stop());
			mediaStream = null;
		}

		if (audioContext) {
			await audioContext.close().catch(() => {});
			audioContext = null;
		}

		setStatus(
			"No fue posible acceder al micrófono. " +
			"Revisa los permisos del navegador o utiliza la demostración.",
			"SIN MICRÓFONO"
		);
	}
}

function stopRecording() {
	if (!isRecording) return;

	durationSeconds = Math.min(
		MAX_SECONDS,
		(performance.now() - recordingStart) / 1000
	);

	isRecording = false;
	clearInterval(timerInterval);
	cancelAnimationFrame(animationId);

	if (recognition) {
		try { recognition.stop(); } catch (_) {}
		recognition = null;
	}

	if (mediaRecorder?.state === "recording") {
		mediaRecorder.stop();
	}

	if (mediaStream) {
		mediaStream.getTracks().forEach(track => track.stop());
		mediaStream = null;
	}

	if (audioContext) {
		audioContext.close().catch(() => {});
		audioContext = null;
	}

	recordBtn.disabled = false;
	stopBtn.disabled = true;
	demoBtn.disabled = false;

	timer.textContent = formatTime(durationSeconds);

	setStatus(
		"Grabación finalizada. Explora los resultados a continuación.",
		"COMPLETADO"
	);

	// Se concede un breve margen para resultados finales del
	// reconocimiento de voz antes de mostrar la transcripción.
	setTimeout(() => {
		renderResults({
			duration: durationSeconds,
			samples: amplitudeSamples,
			energy: energySamples,
			text: transcriptText,
			demo: false
		});
	}, 700);
}

function tokenize(text) {
	return (text.toLowerCase().match(
		/[\p{L}]+(?:['’-][\p{L}]+)*/gu
	) || []);
}

function getKeywords(text) {
	const counts = new Map();

	tokenize(text)
		.filter(word => word.length > 3 && !STOP_WORDS.has(word))
		.forEach(word => {
			counts.set(word, (counts.get(word) || 0) + 1);
		});

	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 12);
}

function drawFingerprint(samples, text, demo = false) {
	const { ctx, width, height } = setupCanvas(fingerprintCanvas);
	const centerX = width / 2;
	const centerY = height / 2;
	const radius = Math.min(width, height) * 0.34;

	ctx.clearRect(0, 0, width, height);

	const words = tokenize(text);
	const lexicalFactor = words.length
		? new Set(words).size / words.length
		: 0.5;

	const safeSamples = samples.length ? samples : [0.2, 0.4, 0.3];

	for (let ring = 0; ring < 7; ring++) {
		const points = 180;
		const baseRadius = radius * (0.27 + ring * 0.105);

		ctx.beginPath();

		for (let i = 0; i <= points; i++) {
			const angle = (i / points) * Math.PI * 2;
			const index = Math.floor(
				(i / points) * (safeSamples.length - 1)
			);

			const signal = safeSamples[index] || 0;
			const variation =
				Math.sin(angle * (4 + ring) + lexicalFactor * 8) *
				(8 + signal * 23);

			const r = baseRadius + variation;
			const x = centerX + Math.cos(angle) * r;
			const y = centerY + Math.sin(angle) * r;

			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}

		ctx.closePath();
		ctx.strokeStyle = [
			"#53e1cc", "#68a9ff", "#b39aff",
			"#53e1cc", "#68a9ff", "#b39aff", "#53e1cc"
		][ring];

		ctx.globalAlpha = 0.42 + ring * 0.07;
		ctx.lineWidth = ring === 6 ? 2.5 : 1.4;
		ctx.stroke();
	}

	ctx.globalAlpha = 1;

	ctx.fillStyle = "#53e1cc";
	ctx.beginPath();
	ctx.arc(centerX, centerY, 5, 0, Math.PI * 2);
	ctx.fill();

	ctx.textAlign = "center";
	ctx.font = "12px DM Sans, sans-serif";
	ctx.fillStyle = "#b6d5e4";
	ctx.fillText(
		demo ? "VISUALIZACIÓN ILUSTRATIVA" : "HUELLA EXPLORATORIA",
		centerX,
		height - 12
	);
}

function renderResults(data) {
	results.hidden = false;
	demoNotice.hidden = !data.demo;

	$("durationValue").textContent =
		data.duration.toFixed(1) + " s";

	const meanEnergy = data.energy.length
		? data.energy.reduce((a, b) => a + b, 0) /
			data.energy.length
		: 0;

	$("energyValue").textContent =
		data.demo ? "Ejemplo" : meanEnergy.toFixed(3);

	const words = tokenize(data.text);
	$("wordCountValue").textContent =
		data.text.trim() ? String(words.length) : "N/D";

	$("transcript").textContent = data.text.trim()
		? data.text
		: "No se obtuvo transcripción automática. " +
			"La grabación y la visualización acústica " +
			"pueden explorarse igualmente.";

	const wordCloud = $("wordCloud");
	wordCloud.replaceChildren();

	const keywords = getKeywords(data.text);

	keywords.forEach(([word, count], index) => {
		const span = document.createElement("span");
		span.textContent = word;
		span.style.fontSize =
			(1.0 + Math.max(0, 5 - index) * 0.12 + count * 0.05) + "rem";
		wordCloud.appendChild(span);
	});

	if (!keywords.length) {
		const span = document.createElement("span");
		span.textContent = "Sin palabras disponibles";
		wordCloud.appendChild(span);
	}

	$("acousticExplanation").textContent = data.demo
		? "Esta forma de onda es una simulación visual. " +
			"En una grabación real se utiliza la señal del micrófono."
		: "Las barras representan variaciones relativas de amplitud " +
			"durante la grabación. No identifican emociones ni capacidades.";

	$("languageExplanation").textContent =
		"Las palabras destacadas son una selección basada " +
		"en frecuencia. No constituyen todavía un análisis " +
		"semántico profundo.";

	drawWave(resultWaveCanvas, data.samples);
	drawFingerprint(data.samples, data.text, data.demo);

	results.scrollIntoView({
		behavior: "smooth",
		block: "start"
	});
}

function runDemo() {
	const samples = Array.from({ length: 180 }, (_, i) => {
		const envelope = 0.3 + 0.4 * Math.abs(Math.sin(i * 0.071));
		const variation = Math.abs(Math.sin(i * 0.47));
		return envelope * variation;
	});

	const energy = samples.map(value => value * 0.14);

	setStatus(
		"Demostración cargada. Los resultados son ilustrativos.",
		"MODO DEMO"
	);

	renderResults({
		duration: 38.4,
		samples,
		energy,
		text: DEMO_TEXT,
		demo: true
	});
}

recordBtn.addEventListener("click", startRecording);
stopBtn.addEventListener("click", stopRecording);
demoBtn.addEventListener("click", runDemo);

window.addEventListener("resize", () => {
	if (!isRecording) {
		drawWave(waveCanvas, []);
	}
});

drawWave(waveCanvas, []);
