import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import Webcam from 'react-webcam';
import * as blazeface from '@tensorflow-models/blazeface';
import '@tensorflow/tfjs';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './WebcamCapture.css';
import axios from 'axios';

const WebcamCapture = () => {


  const reverseGeocode = useCallback(async (lat, lon) => {
    try {
      if (lat == null || lon == null) return null;
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
        lat
      )}&lon=${encodeURIComponent(lon)}&accept-language=en`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) return null;
      const json = await res.json();
      // Prefer display_name, otherwise try address components
      if (json && json.display_name) return json.display_name;
      if (json && json.address) return Object.values(json.address).join(', ');
      return null;
    } catch (e) {
      // Network error or aborted — return null silently
      // eslint-disable-next-line no-console
      console.debug('Reverse geocode failed', e && e.message ? e.message : e);
      return null;
    }
  }, []);



  const webcamRef = useRef(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [model, setModel] = useState(null);
  const [started, setStarted] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [stoppedState, setStoppedState] = useState('idle');
  const [geolocation, setGeolocation] = useState(null);
  const [geoError, setGeoError] = useState(null);

  const isProcessingRef = useRef(false);
  const modelLoadedRef = useRef(false);
  const faceDetectedRef = useRef(false);
  const lastToastTimeRef = useRef({});
  const lastCaptureTimeRef = useRef(0);
  const captureTimeoutRef = useRef(null);
  const nextAllowedCaptureAtRef = useRef(0);

  const markAttendance = (formData) => {
    return axios.post(
      'https://apigatekeeper.cloudgentechnologies.com/api/attendance/',
      // 'http://localhost:8000/api/attendance/',
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );
  };

  const dismissAllToasts = useCallback(() => {
    toast.dismiss();
  }, []);

  const showToast = useCallback(
    (type, title, message, key = null, options = {}) => {
      if (key) {
        const now = Date.now();
        if (lastToastTimeRef.current[key] && now - lastToastTimeRef.current[key] < 3000) {
          return;
        }
        lastToastTimeRef.current[key] = now;
      }

      const toastContent = (
        <div className="custom-toast-content">
          {options?.photo && (
            <div className="toast-photo-frame">
              <img
                src={
                  options?.photo.startsWith('data:') || options?.photo?.startsWith('http')
                    ? options.photo
                    : `data:image/jpeg;base64,${options.photo}`
                }
                alt="Face"
              />
            </div>
          )}
          <div className="toast-text-group">
            <div className="toast-header">
              <strong className="toast-title">{title}</strong>
              {options.timestamp && (
                <span className="toast-time">
                  {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
            <div className="toast-message">{message}</div>

            {(options.confidence || options.location) && (
              <div className="toast-meta">
                {options.confidence && (
                  <span className="meta-tag confidence">
                    <span className="meta-icon">🎯</span> {options.confidence}%
                  </span>
                )}
                {options.location && (
                  <span className="meta-tag location">
                    <span className="meta-icon">📍</span>{' '}
                    {Number(options.location.latitude).toFixed(4)},{' '}
                    {Number(options.location.longitude).toFixed(4)}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      );

      toast(toastContent, {
        type: type === 'success' ? 'success' : type === 'error' ? 'error' : 'info',
        autoClose: options.durationMs ?? 4000,
        hideProgressBar: true,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        className: `premium-toast-item ${type}`,
        icon: false,
      });
    },
    []
  );

  const speakText = useCallback((text) => {
    try {
      if (typeof window === 'undefined' || !window.speechSynthesis) return;
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'en-US';
      utter.rate = 0.9;
      utter.pitch = 1.2;
      utter.volume = 1.0;

      const voices = window.speechSynthesis.getVoices();
      const femaleVoice = voices.find(voice => voice.name.includes('Female') || voice.name.includes('woman')) || voices.find(voice => voice.name && !voice.name.includes('Male') && !voice.name.includes('man'));
      if (femaleVoice) {
        utter.voice = femaleVoice;
      }

      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    } catch (e) {
      // ignore speech errors
      console.warn('Speech synthesis failed', e);
    }
  }, []);

  useEffect(() => {
    if (!started || modelLoadedRef.current) return;
    let cancelled = false;

    const loadModel = async () => {
      try {
        const loadedModel = await blazeface.load();
        if (!cancelled) {
          setModel(loadedModel);
          modelLoadedRef.current = true;
        }
      } catch (err) {
        console.error('Failed to load model', err);
      }
    };

    loadModel();
    return () => {
      cancelled = true;
    };
  }, [started, showToast]);

  const stopCamera = useCallback(() => {
    try {
      const stream = webcamRef.current?.video?.srcObject;
      if (stream && stream.getTracks) {
        stream.getTracks().forEach((t) => t.stop());
      }
    } catch (e) {
      console.warn('Error stopping camera tracks', e);
    }
    setCameraActive(false);
    faceDetectedRef.current = false;
    setFaceDetected(false);
  }, []);

  const stopCameraWith = useCallback(
    (reason) => {
      try {
        const stream = webcamRef.current?.video?.srcObject;
        if (stream && stream.getTracks) {
          stream.getTracks().forEach((t) => t.stop());
        }
      } catch (e) {
        console.warn('Error stopping camera tracks', e);
      }
      setCameraActive(false);
      faceDetectedRef.current = false;
      setFaceDetected(false);
      // If the stop reason is an error, don't show the "retry" stopped screen —
      // reset to the initial idle/start state and keep the user on the mark-attendance card.
      if (reason === 'error') {
        setStarted(false);
        setStoppedState('idle');
      } else {
        setStoppedState(reason || 'idle');
      }
    },
    []
  );

  const fetchGeolocation = useCallback(() => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        console.warn('Geolocation not supported by browser');
        setGeoError('Geolocation not available');
        resolve(null);
        return;
      }

      (async () => {
        let permState = null;
        try {
          if (navigator.permissions && navigator.permissions.query) {
            const status = await navigator.permissions.query({ name: 'geolocation' });
            permState = status.state;
            console.debug('Geolocation permission state:', status.state);
            if (status.state === 'denied') {
              setGeoError('Permission denied');
              setGeolocation(null);
              resolve(null);
              return;
            }
          }
        } catch (e) {

          console.debug('Permissions API check failed', e);
        }

        const attempt = (highAccuracy, timeout) =>
          new Promise((res) => {
            navigator.geolocation.getCurrentPosition(
              (position) => {
                const { latitude, longitude, accuracy } = position.coords;
                const geoData = { latitude, longitude, accuracy, permState };
                setGeolocation(geoData);
                setGeoError(null);
                // eslint-disable-next-line no-console
                console.debug('Geolocation fetched:', geoData);
                res({ success: true, data: geoData });
              },
              (error) => {
                console.warn('Geolocation error:', error.code, error.message);
                res({ success: false, error });
              },
              { enableHighAccuracy: highAccuracy, timeout, maximumAge: 0 }
            );
          });

        let result = await attempt(true, 10000);
        if (!result.success) {
          if (permState === 'granted') {
            result = await attempt(false, 20000);
          }
        }

        if (result.success) {
          resolve(result.data);
          return;
        }

        const err = result.error;
        const errMsg = err ? `(${err.code}) ${err.message}` : 'Unknown geolocation error';
        setGeoError(errMsg);
        setGeolocation(null);
        resolve(null);
      })();
    });
  }, []);

  // useEffect(() => {
  //   const rawPath = location.pathname === '/' ? '/dashboard' : location.pathname;
  //   const matched = sidebarItems.find(
  //     (item) => rawPath === item.route || rawPath.startsWith(`${item.route}/`)
  //   );
  //   if (matched) {
  //     setActiveTab(matched.id);
  //     if (matched.id === 'attendance') {
  //       // Auto-start camera when entering attendance tab
  //       if (!started) {
  //         modelLoadedRef.current = false;
  //         setStarted(true);
  //         setCameraActive(true);
  //         setStoppedState('idle');
  //         // Fetch geolocation early
  //         fetchGeolocation();
  //       }
  //     } else {
  //       if (cameraActive) {
  //         stopCamera();
  //       }
  //       setStarted(false);
  //       setStoppedState('idle');
  //     }
  //     return;
  //   }
  // }, [cameraActive, stopCamera, started, fetchGeolocation]);

  const handleStart = async () => {
    // Explicit user action to request location permission first, then start camera.
    dismissAllToasts();
    const geo = await fetchGeolocation();
    if (!geo) return;
    if (!started) {
      modelLoadedRef.current = false;
    }
    setStarted(true);
    setCameraActive(true);
  };

  const captureAndSend = useCallback(async () => {
    if (!webcamRef.current || isProcessingRef.current) return;

    const imageSrc = webcamRef.current.getScreenshot();
    if (!imageSrc) return;

    // Start cooldown immediately to prevent any re-trigger while request/UX (toast/voice) happens.
    // This fixes the "captures again right after response" race.
    lastCaptureTimeRef.current = Date.now();
    // Also block any further auto-captures until explicitly allowed.
    // We'll extend this on success to 5–10s after the response.
    nextAllowedCaptureAtRef.current = Math.max(nextAllowedCaptureAtRef.current, lastCaptureTimeRef.current);

    isProcessingRef.current = true;
    setIsProcessing(true);

    try {
      // Use existing geolocation or fetch if not available
      let geoData = geolocation;
      if (!geoData) {
        geoData = await fetchGeolocation();
      }
      if (!geoData) {
        let permState = null;
        try {
          if (navigator.permissions && navigator.permissions.query) {
            const perm = await navigator.permissions.query({ name: 'geolocation' });
            permState = perm.state;
          }
        } catch (e) {
          // ignore
        }

        const details = geoError ? ` (${geoError})` : '';
        const permMsg = permState ? ` Permission: ${permState}.` : '';
        showToast(
          'error',
          'Location Needed',
          `Enable location on your device and browser to mark attendance${details}${permMsg} If already allowed, refresh the page or check site permissions (HTTPS/localhost required).`,
          'attendance-location-missing',
          { durationMs: 10000 }
        );
        // Allow retry after a short delay (keeps camera open but stops rapid loops)
        nextAllowedCaptureAtRef.current = Date.now() + 10000;
        setTimeout(() => {
          isProcessingRef.current = false;
          setIsProcessing(false);
        }, 1000);
        return;
      }

      const blob = await (await fetch(imageSrc)).blob();
      const formData = new FormData();
      formData.append('image', blob, 'face.jpg');

      // Append geolocation data if available
      // Round to 6 decimal places to match Django DecimalField(decimal_places=6)
      formData.append('latitude', Number(geoData.latitude).toFixed(6));
      formData.append('longitude', Number(geoData.longitude).toFixed(6));
      formData.append('accuracy', geoData.accuracy);

      // Address is optional - backend can reverse geocode if needed

      try {
        console.debug('attendance formData entries:', Array.from(formData.entries()));
      } catch (e) { }
      const response = await markAttendance(formData);
      const data = response.data;
      console.log('Attendance response:', data);

      // Treat any valid status/message as success, not just 'successful', 'checkin', or 'checkout'
      if (data.status && data.message) {
        let toastTitle = 'Attendance Marked';
        let toastType = 'success';
        let toastKey = 'attendance-success';
        let toastMsg = data.message;

        // Special handling for already marked
        if (data.status === 'Already marked') {
          toastTitle = 'Already Checked In/Out';
          toastType = 'info';
          toastKey = 'attendance-already-marked';
        }

        // Add geolocation info if available
        try {
          if (geoData) {
            const coords = `${Number(geoData.latitude).toFixed(6)}, ${Number(geoData.longitude).toFixed(6)}`;
            toastMsg += `\nLocation: ${coords} (±${Math.round(geoData.accuracy)}m)`;
          }
          const serverAddress = data?.location?.address;
          if (serverAddress) {
            toastMsg += `\nAddress: ${serverAddress}`;
          }
        } catch (e) { }

        showToast(
          toastType,
          toastTitle,
          toastMsg,
          toastKey,
          {
            durationMs: toastType === 'info' ? 5000 : 6000,
            variant: 'hero',
            // photo: data.photo,
            confidence: data.confidence,
            timestamp: data.timestamp,
            location: geoData || null,
          }
        );

        // Speak a short friendly message for accessibility if available
        try {
          const employeeName = data?.employee || '';
          let speakMsg = '';
          if (data.status === 'Already marked') {
            speakMsg = employeeName
              ? `your attendance for today is already recorded. Have a Good day.`
              : 'Your attendance for today is already recorded. Have a Good day.';
          } else {
            speakMsg = employeeName
              ? ` ${data.message}`
              : data.message;
          }
          speakText(speakMsg);
        } catch (e) { }

        // After an attendance response, wait 5–10s before allowing the next auto-capture.
        // (You can tweak this value as needed.)
        const postSuccessCooldownMs = 8000;
        nextAllowedCaptureAtRef.current = Date.now() + postSuccessCooldownMs;
        isProcessingRef.current = false;
        setIsProcessing(false);
        return;
      } else {
        console.log('Unknown response status:', data.status);
        showToast('error', 'Unknown Response', 'Received unexpected response from server.', 'attendance-unknown', { durationMs: 6000 });
        nextAllowedCaptureAtRef.current = Date.now() + 6000;
        isProcessingRef.current = false;
        setIsProcessing(false);
      }
    } catch (error) {
      let errMsg = 'Server connection failed';
      let errTitle = 'Connection Error';

      if (error.response?.data?.error) {
        switch (error.response.data.error) {
          case 'No face detected':
            errTitle = 'No Face Found';
            errMsg = 'Please ensure your face is clearly visible in the frame';
            break;
          case 'Face not recognized':
            errTitle = 'Unregistered Face';
            errMsg = 'Your face is not registered in the system. Please contact administrator.';
            break;
          default:
            errTitle = 'Error';
            errMsg = error.response.data.error;
        }
      } else if (error.response?.data) {
        const errorData = error.response.data;
        const errorKeys = Object.keys(errorData);

        if (errorKeys.length > 0) {
          errTitle = 'Validation Error';
          const firstErrorKey = errorKeys[0];
          const firstError = errorData[firstErrorKey];
          errMsg = Array.isArray(firstError) ? firstError[0] : firstError;
        }
      }

      showToast('error', errTitle, errMsg, 'attendance-error', { durationMs: 10000 });

      stopCameraWith('error');
      nextAllowedCaptureAtRef.current = Date.now() + 10000;
      isProcessingRef.current = false;
      setIsProcessing(false);
    }
  }, [showToast, stopCameraWith, fetchGeolocation, geolocation, geoError]);

  useEffect(() => {
    if (!started || !cameraActive || !model) {
      if (faceDetectedRef.current !== false) {
        faceDetectedRef.current = false;
        setFaceDetected(false);
      }
      if (captureTimeoutRef.current) {
        clearTimeout(captureTimeoutRef.current);
        captureTimeoutRef.current = null;
      }
      return;
    }

    const detectFace = async () => {
      if (
        !webcamRef.current ||
        !webcamRef.current.video ||
        webcamRef.current.video.readyState !== 4 ||
        isProcessingRef.current
      ) {
        if (faceDetectedRef.current !== false) {
          faceDetectedRef.current = false;
          setFaceDetected(false);
        }
        return;
      }

      try {
        const predictions = await model.estimateFaces(webcamRef.current.video, false);
        const detected = predictions && predictions.length > 0;

        if (faceDetectedRef.current !== detected) {
          faceDetectedRef.current = detected;
          setFaceDetected(detected);
        }

        if (detected && !isProcessingRef.current && !captureTimeoutRef.current) {
          const now = Date.now();
          const cooldownMs = 10000;
          const allowedByTime =
            now - lastCaptureTimeRef.current > cooldownMs && now >= nextAllowedCaptureAtRef.current;
          if (allowedByTime) {
            captureTimeoutRef.current = setTimeout(async () => {
              if (faceDetectedRef.current && !isProcessingRef.current && webcamRef.current?.video?.readyState === 4) {
                try {
                  // Double-check if face is still present right before capturing
                  const predictions = await model.estimateFaces(webcamRef.current.video, false);
                  if (!predictions || predictions.length === 0) {
                    console.log('Face lost before capture, aborting.');
                    faceDetectedRef.current = false;
                    setFaceDetected(false);
                    captureTimeoutRef.current = null;
                    return;
                  }

                  await captureAndSend();
                } catch (e) {
                  console.error('Auto-capture error', e);
                  lastCaptureTimeRef.current = Date.now();
                  nextAllowedCaptureAtRef.current = Date.now() + 6000;
                  isProcessingRef.current = false;
                  setIsProcessing(false);
                }
              }
              captureTimeoutRef.current = null;
            }, 2000);
          }
        } else if (!detected && captureTimeoutRef.current) {
          clearTimeout(captureTimeoutRef.current);
          captureTimeoutRef.current = null;
        }
      } catch (err) {
        console.error('Detection error', err);
        if (faceDetectedRef.current !== false) {
          faceDetectedRef.current = false;
          setFaceDetected(false);
        }
      }
    };

    const interval = setInterval(detectFace, 900); // Check every 500ms for faster detection

    return () => {
      clearInterval(interval);
      if (captureTimeoutRef.current) {
        clearTimeout(captureTimeoutRef.current);
        captureTimeoutRef.current = null;
      }
    };
  }, [started, cameraActive, model, captureAndSend]);

  const handleRetry = useCallback(() => {
    // console.log('retry')
    dismissAllToasts();
    isProcessingRef.current = false;
    setIsProcessing(false);
    lastCaptureTimeRef.current = 0; // Reset to allow immediate retry on manual retry
    nextAllowedCaptureAtRef.current = 0;
    setStoppedState('idle');
    setCameraActive(true);
  }, [dismissAllToasts]);

  // On page open: require location first, then auto-start camera once allowed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // If already started (manual retry flow), don't interfere.
      if (started) return;
      const geo = await fetchGeolocation();
      if (cancelled) return;
      if (geo) {
        // Location allowed: auto-start camera/workflow.
        modelLoadedRef.current = false;
        setStarted(true);
        setCameraActive(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchGeolocation, started]);


  return (
    <div className="app-shell">
      <div className="main-wrapper">
        <main className="main-content">
          <div className="attendance-screen">
            {!started ? (
              <div className="attendance-start">
                <div className="start-card">
                  <div className="start-icon-wrapper">
                    <div className="start-icon">📸</div>
                  </div>
                  <h2 className="start-title">Enable Location to Continue</h2>
                  <p className="start-description">
                    We first need your location permission. After that, we’ll open the camera and auto-mark attendance when your face is detected.
                  </p>
                  <button className="start-attendance-button" onClick={handleStart}>
                    Allow Location & Start
                  </button>
                </div>
              </div>
            ) : (
              <>
                {cameraActive ? (
                  <div className="camera-container">
                    <Webcam
                      audio={false}
                      ref={webcamRef}
                      screenshotFormat="image/jpeg"
                      className="camera-feed"
                      videoConstraints={{
                        facingMode: 'user',
                        width: { min: 320, ideal: 1920, max: 2560 },
                        height: { min: 240, ideal: 1080, max: 1440 },
                        aspectRatio: 16 / 9
                      }}
                      style={{
                        width: '100%',
                        height: '100%',
                        maxHeight: '100vh',
                        objectFit: 'contain',
                        backgroundColor: '#000'
                      }}
                    />

                    {model && (
                      <div className="detection-frame">
                        <div className="scanning-line"></div>
                      </div>
                    )}

                    {isProcessing && (
                      <div className="processing-overlay">
                        <div className="processing-content">
                          <div className="spinner"></div>
                          <div className="processing-text">Processing...</div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="camera-stopped">
                    <div className="stopped-card">
                      <div className="stopped-icon">{stoppedState === 'error' ? '⚠️' : '✓'}</div>
                      <h2 className="stopped-title">
                        {stoppedState === 'error' ? 'Let\'s Try Again' : stoppedState === 'cancelled' ? 'Camera Stopped' : stoppedState === 'retry' ? 'Ready to Continue' : 'Capture Complete'}
                      </h2>
                      <p className="stopped-description">
                        {stoppedState === 'error'
                          ? 'We could not confirm your face. Ensure good lighting and keep your face centered.'
                          : stoppedState === 'cancelled'
                            ? 'You can resume anytime. Click below to try again.'
                            : stoppedState === 'retry'
                              ? 'Click below to resume your attendance capture.'
                              : 'Attendance has been submitted. You can retry to capture again if needed.'}
                      </p>
                      <button className="retry-button" onClick={handleRetry}>
                        Retry Attendance
                      </button>
                    </div>
                  </div>
                )}

                {cameraActive && !isProcessing && (
                  <div className="bottom-controls">
                    <button className="control-button" onClick={() => stopCameraWith('cancelled')}>
                      Cancel
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* )} */}


        </main>
      </div>

      {/* Toast container */}
      <ToastContainer
        position="bottom-center"
        autoClose={5000}
        hideProgressBar
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="light"
        toastClassName="premium-toast-glass"
        bodyClassName="premium-toast-body"
        style={{ bottom: '100px', zIndex: 9999, padding: '0 16px' }}
      />

    </div>
  );
};

export default WebcamCapture;