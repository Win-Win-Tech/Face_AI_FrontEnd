import React, { useRef, useState, useEffect, useCallback } from 'react';
import Webcam from 'react-webcam';
import axios from 'axios';
import * as blazeface from '@tensorflow-models/blazeface';
import '@tensorflow/tfjs';
import './WebcamCapture.css';

const WebcamCapture = () => {
  const webcamRef = useRef(null);
  const [toasts, setToasts] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [model, setModel] = useState(null);
  const [started, setStarted] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [stoppedState, setStoppedState] = useState('idle');

  const isProcessingRef = useRef(false);
  const modelLoadedRef = useRef(false);
  const faceDetectedRef = useRef(false);
  const lastToastTimeRef = useRef({});

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.map(toast => 
      toast.id === id ? { ...toast, exiting: true } : toast
    ));
    setTimeout(() => {
      setToasts(prev => prev.filter(toast => toast.id !== id));
    }, 300);
  }, []);

  const dismissAllToasts = useCallback(() => {
    setToasts(prev => prev.map(toast => ({ ...toast, exiting: true })));
    setTimeout(() => {
      setToasts([]);
    }, 300);
  }, []);

  const showToast = useCallback((type, title, message, key = null, options = {}) => {
    if (key) {
      const now = Date.now();
      if (lastToastTimeRef.current[key] && now - lastToastTimeRef.current[key] < 3000) {
        return;
      }
      lastToastTimeRef.current[key] = now;
    }

    const id = Date.now();
    const toast = { id, type, title, message, variant: options.variant, options };
    setToasts(prev => [...prev, toast]);
    
    setTimeout(() => {
      removeToast(id);
    }, options.durationMs ?? 3000);
  }, [removeToast]);

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

  const stopCameraWith = useCallback((reason) => {
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
    setStoppedState(reason || 'idle');
  }, []);

  const fetchAttendanceDetails = async (employeeId) => {
    try {
      //const response = await axios.get(`http://127.0.0.1:8000/api/attendance-summary/`);
      const response = await axios.get(`https://apigatekeeper.cloudgentechnologies.com/api/attendance-summary/`);
      const employeeData = response.data.find(record => record.employee === employeeId);
      return employeeData;
    } catch (error) {
      console.error('Error fetching attendance details:', error);
      return null;
    }
  };

  const captureAndSend = useCallback(async () => {
    if (!webcamRef.current || isProcessingRef.current) return;
    
    const imageSrc = webcamRef.current.getScreenshot();
    if (!imageSrc) return;

    isProcessingRef.current = true;
    setIsProcessing(true);
    
    try {
      const blob = await (await fetch(imageSrc)).blob();
      const formData = new FormData();
      formData.append('image', blob, 'face.jpg');

      const response = await axios.post(
        //'http://127.0.0.1:8000/api/attendance/',
        'https://apigatekeeper.cloudgentechnologies.com/api/attendance/',
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );

      const data = response.data;
      console.log("data", data);
      
      if (data.status === 'Already marked') {
        const attendanceDetails = await fetchAttendanceDetails(data.employee);
        const checkinTime = attendanceDetails?.checkin ? 
          new Date(`2000-01-01 ${attendanceDetails.checkin}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 
          'Not marked';
        const checkoutTime = attendanceDetails?.checkout ? 
          new Date(`2000-01-01 ${attendanceDetails.checkout}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 
          'Not marked';

        const message = `Hello ${data.employee}!\nYour attendance for today is already recorded:\n\nCheck-in: ${checkinTime}\nCheck-out: ${checkoutTime}`;
        
        showToast(
          'info',
          'Already Checked In/Out',
          message,
          'attendance-already-marked',
          { 
            durationMs: 8000, 
            variant: 'hero',
            photo: data.photo
          }
        );
        stopCameraWith('completed');
        setTimeout(() => {
          setStarted(false);
        }, 2000);
      } else if (data.status?.includes('successful')) {
        const isCheckin = data.status.toLowerCase().includes('checkin');
        showToast(
          'success',
          isCheckin ? 'Check-In Successful' : 'Check-Out Successful',
          data.message,
          'attendance-success',
          { 
            durationMs: 6000, 
            variant: 'hero',
            confidence: data.confidence,
            timestamp: data.timestamp,
            photo: data.photo
          }
        );
        stopCameraWith('completed');
        setTimeout(() => {
          setStarted(false);
        }, 2000);
      } else {
        showToast(
          'error',
          'Unknown Response',
          'Received unexpected response from server.',
          'attendance-unknown'
        );
      }
      
      setTimeout(() => {
        isProcessingRef.current = false;
        setIsProcessing(false);
      }, 2000);
      
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
      }
      
      showToast('error', errTitle, errMsg, 'attendance-error', { durationMs: 10000 });
      
      stopCameraWith('error');
      isProcessingRef.current = false;
      setIsProcessing(false);
    }
  }, [showToast, stopCameraWith, fetchAttendanceDetails]);

  useEffect(() => {
    if (!started || !cameraActive || !model) {
      if (faceDetectedRef.current !== false) {
        faceDetectedRef.current = false;
        setFaceDetected(false);
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
        
        if (detected && !isProcessingRef.current) {
          captureAndSend();
        }
      } catch (err) {
        console.error('Detection error', err);
        if (faceDetectedRef.current !== false) {
          faceDetectedRef.current = false;
          setFaceDetected(false);
        }
      }
    };

    const interval = setInterval(detectFace, 1000);
    
    return () => {
      clearInterval(interval);
    };
  }, [started, cameraActive, model, captureAndSend]);

  const handleStart = () => {
    if (!started) {
      modelLoadedRef.current = false;
    }
    dismissAllToasts();
    setStarted(true);
    setCameraActive(true);
  };

  const handleRetry = useCallback(() => {
    dismissAllToasts();
    setStarted(false);
    setCameraActive(false);
    isProcessingRef.current = false;
    setIsProcessing(false);
    setStoppedState('idle');
  }, [dismissAllToasts]);

  // handleTabChange removed — app is attendance-only now

  // No routing — single page only

  return (
    <div className="app-shell">
      {/* Sidebar and navigation removed — simplified to attendance-only UI */}

      <div className="main-wrapper">
        <main className="main-content">
          {/* Attendance screen (only page) */}
            <div className="attendance-screen">
              {!started ? (
                <div className="attendance-start">
                  <div className="start-card">
                    <div className="start-icon-wrapper">
                      <div className="start-icon">📸</div>
                    </div>
                    <h2 className="start-title">Ready to Mark Attendance</h2>
                    <p className="start-description">
                      Activate your camera to launch the real-time face recognition workflow.
                    </p>
                    <button className="start-attendance-button" onClick={handleStart}>
                      Mark my attendance
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
                          aspectRatio: 16/9
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
        </main>
      </div>

      {/* Bottom tab navigation removed */}

      <div className="toast-container">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`toast ${toast.type} ${toast.variant || ''} ${toast.exiting ? 'toast-exit' : ''}`}
          >
            <div className="toast-icon">
              {toast.type === 'success' && '✓'}
              {toast.type === 'error' && '✕'}
              {toast.type === 'info' && 'i'}
            </div>
            <div className="toast-content">
              <div className="toast-header">
                {toast.options?.photo && (
                  <div className="toast-photo">
                    <img src={toast.options.photo} alt="Employee" />
                  </div>
                )}
                <div>
                  <div className="toast-title">{toast.title}</div>
                  <div className="toast-message">{toast.message}</div>
                </div>
              </div>
              {(toast.options?.confidence || toast.options?.timestamp || toast.options?.times) && (
                <div className="toast-details">
                  {toast.options.confidence && (
                    <div className="toast-confidence">
                      Match Confidence: {(toast.options.confidence * 100).toFixed(0)}%
                    </div>
                  )}
                  {toast.options.timestamp && toast.type !== 'info' && (
                    <div className="toast-timestamp">
                      {new Date(toast.options.timestamp).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              )}
            </div>
            <button
              className="toast-close"
              onClick={() => removeToast(toast.id)}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default WebcamCapture;