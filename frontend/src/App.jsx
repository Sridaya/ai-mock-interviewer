import { useState, useEffect } from 'react'
import './App.css'

const API_URL = 'http://127.0.0.1:8000'

function App() {
  const [selectedField, setSelectedField] = useState('')
  const [interviewStarted, setInterviewStarted] = useState(false)
  const [interviewEnded, setInterviewEnded] = useState(false)
  const [currentQuestion, setCurrentQuestion] = useState('')
  const [currentAnswer, setCurrentAnswer] = useState('')
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [resumeFile, setResumeFile] = useState(null)
  const [resumeText, setResumeText] = useState('')
  const [isListening, setIsListening] = useState(false)

  const fields = [
    'Frontend Developer',
    'Backend Developer',
    'Python Developer',
    'Java Developer',
    'Full Stack Developer',
    'Data Science',
    'AI/ML Engineer',
    'QA/Tester',
    'HR'
  ]

  const speakText = (text) => {
    // Cancel any speech that might already be playing
    window.speechSynthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1
    utterance.pitch = 1
    window.speechSynthesis.speak(utterance)
  }

  const startListening = () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition

  if (!SpeechRecognition) {
    alert('Speech recognition is not supported in this browser. Try Chrome or Edge.')
    return
  }

  const recognition = new SpeechRecognition()
  recognition.lang = 'en-US'
  recognition.continuous = false     // stops automatically after one answer
  recognition.interimResults = false // only give us the final result, not partial guesses

  recognition.onstart = () => {
    setIsListening(true)
  }

  recognition.onresult = (event) => {
    const spokenText = event.results[0][0].transcript
    setCurrentAnswer((prev) => (prev ? prev + ' ' + spokenText : spokenText))
  }

  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error)
    setIsListening(false)
  }

  recognition.onend = () => {
    setIsListening(false)
  }

  recognition.start()
}

  // Automatically speak the question whenever it changes
  useEffect(() => {
    if (currentQuestion) {
      speakText(currentQuestion)
    }
  }, [currentQuestion])

  const handleStart = async () => {
    if (!selectedField) {
      alert('Please select a field first')
      return
    }

    setLoading(true)
    try {
      let extractedResumeText = ''

      // Step A: If a resume was uploaded, extract its text first
      if (resumeFile) {
        const formData = new FormData()
        formData.append('file', resumeFile)

        const uploadResponse = await fetch(`${API_URL}/upload-resume`, {
          method: 'POST',
          body: formData
        })
        const uploadData = await uploadResponse.json()
        extractedResumeText = uploadData.resume_text
        setResumeText(extractedResumeText)
      }

      // Step B: Generate the first question (personalized if we have resume text)
      const params = new URLSearchParams({
        field: selectedField,
        resume_text: extractedResumeText
      })

      const response = await fetch(`${API_URL}/generate-question?${params.toString()}`)
      const data = await response.json()
      setCurrentQuestion(data.question)
      setHistory([{ role: 'interviewer', content: data.question }])
      setInterviewStarted(true)
    } catch (error) {
      alert('Could not reach the backend. Is it running?')
      console.error(error)
    }
    setLoading(false)
  }

  const handleSubmitAnswer = async () => {
    if (!currentAnswer.trim()) {
      alert('Please type an answer first')
      return
    }

    setLoading(true)
    try {
      const response = await fetch(`${API_URL}/next-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: selectedField,
          history: history,
          answer: currentAnswer
        })
      })
      const data = await response.json()

      const updatedHistory = [
        ...history,
        { role: 'candidate', content: currentAnswer },
        { role: 'interviewer', content: data.question }
      ]

      setHistory(updatedHistory)
      setCurrentQuestion(data.question)
      setCurrentAnswer('')
    } catch (error) {
      alert('Could not reach the backend. Is it running?')
      console.error(error)
    }
    setLoading(false)
  }

  const handleEndInterview = async () => {
    // Include the final answer if the user typed one but didn't submit it
    let finalHistory = history
    if (currentAnswer.trim()) {
      finalHistory = [...history, { role: 'candidate', content: currentAnswer }]
    }

    setLoading(true)
    try {
      const response = await fetch(`${API_URL}/evaluate-interview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: selectedField,
          history: finalHistory
        })
      })
      const data = await response.json()
      setResult(data)
      setInterviewEnded(true)
    } catch (error) {
      alert('Could not reach the backend. Is it running?')
      console.error(error)
    }
    setLoading(false)
  }

  const handleRestart = () => {
    setSelectedField('')
    setInterviewStarted(false)
    setInterviewEnded(false)
    setCurrentQuestion('')
    setCurrentAnswer('')
    setHistory([])
    setResult(null)
    setResumeFile(null)
    setResumeText('')
  }

  const handleDownloadReport = async () => {
  setLoading(true)
  try {
    const response = await fetch(`${API_URL}/generate-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        field: selectedField,
        history: history,
        result: result
      })
    })

    // Convert the response into a downloadable file blob
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)

    // Create a temporary invisible link and "click" it to trigger download
    const link = document.createElement('a')
    link.href = url
    link.download = `${selectedField.replace(/\s+/g, '_')}_Interview_Report.pdf`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    // Clean up the temporary URL
    window.URL.revokeObjectURL(url)
  } catch (error) {
    alert('Could not generate the report. Is the backend running?')
    console.error(error)
  }
  setLoading(false)
}
  // SCREEN 1: Field selection
  if (!interviewStarted) {
    return (
      <div className="app-container">
        <span className="eyebrow">Voice-Enabled Practice</span>
        <h1>AI Mock Interviewer</h1>
        <div className="waveform">
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
        </div>
        <p>Choose your field to begin</p>
        ...
        <select
          value={selectedField}
          onChange={(e) => setSelectedField(e.target.value)}
        >
          <option value="">-- Select a field --</option>
          {fields.map((field) => (
            <option key={field} value={field}>
              {field}
            </option>
          ))}
        </select>
        <div className="upload-section">
          <label>Upload your resume (optional):</label>
          <input
            type="file"
            accept=".pdf"
            onChange={(e) => setResumeFile(e.target.files[0])}
          />
          {resumeFile && <p className="file-name">📄 {resumeFile.name}</p>}
        </div>
        <button onClick={handleStart} disabled={loading}>
          {loading ? "Loading..." : "Start Interview"}
        </button>
      </div>
    );
  }

  // SCREEN 3: Results screen
  if (interviewEnded && result) {
    return (
      <div className="app-container">
        <h1>Interview Results</h1>

        <div className="result-box">
          <p className="score">{result.overall_score} / 10</p>
          <p className="recommendation">{result.recommendation}</p>

          <h3>Strengths</h3>
          <ul>
            {result.strengths.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>

          <h3>Weaknesses</h3>
          <ul>
            {result.weaknesses.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>

          <h3>Detailed Feedback</h3>
          <p>{result.detailed_feedback}</p>
        </div>

        <button onClick={handleRestart}>Start New Interview</button>
        <button onClick={handleDownloadReport} disabled={loading}>
          {loading ? "Generating PDF..." : "📄 Download Report"}
        </button>

        <button onClick={handleRestart}>Start New Interview</button>
      </div>
    );
  }

  // SCREEN 2: Active interview
  return (
    <div className="app-container">
      <h1>{selectedField} Interview</h1>

      <div className="question-box">
        <p>
          <strong>Question:</strong>
        </p>
        <p>{currentQuestion}</p>
        <button
          className="speak-button"
          onClick={() => speakText(currentQuestion)}
        >
          🔊 Replay Question
        </button>
      </div>

      <textarea
        placeholder="Type your answer here..."
        value={currentAnswer}
        onChange={(e) => setCurrentAnswer(e.target.value)}
        rows={5}
      />

      <button onClick={handleSubmitAnswer} disabled={loading}>
        {loading ? "Thinking..." : "Submit Answer"}
      </button>

      <button
        className="end-button"
        onClick={handleEndInterview}
        disabled={loading}
      >
        End Interview & Get Feedback
      </button>

      <p className="progress-note">
        Questions answered:{" "}
        {history.filter((h) => h.role === "candidate").length}
      </p>

      <textarea
        placeholder="Type your answer here, or use the mic..."
        value={currentAnswer}
        onChange={(e) => setCurrentAnswer(e.target.value)}
        rows={5}
      />

      <button
        className={isListening ? "mic-button listening" : "mic-button"}
        onClick={startListening}
        disabled={isListening}
      >
        {isListening ? "🎤 Listening..." : "🎤 Speak Answer"}
      </button>
    </div>
  );
}

export default App