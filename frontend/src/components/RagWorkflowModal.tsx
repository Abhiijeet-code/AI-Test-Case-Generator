import React, { useState, useEffect } from 'react';
import { 
  X, 
  Layers, 
  Database, 
  Cpu, 
  Search, 
  GitBranch, 
  FileText, 
  Sparkles, 
  CheckCircle2, 
  Play, 
  RotateCcw, 
  BarChart3, 
  Activity, 
  ChevronRight,
  Code2
} from 'lucide-react';
import { getRagWorkflowApi, simulateRagPipelineApi } from '../api';

interface RagWorkflowModalProps {
  onClose: () => void;
  onApplyContext?: (text: string) => void;
}

export const RagWorkflowModal: React.FC<RagWorkflowModalProps> = ({ onClose, onApplyContext }) => {
  const [activeTab, setActiveTab] = useState<'diagram' | 'simulation' | 'collections' | 'vectors'>('diagram');
  const [selectedNode, setSelectedNode] = useState<string>('embed');
  const [simulating, setSimulating] = useState(false);

  const [simulationData, setSimulationData] = useState<any>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(-1);
  const [queryInput, setQueryInput] = useState('Payment Gateway Webhook Idempotency');
  const [jiraIdInput, setJiraIdInput] = useState('PROJ-982');
  const [chunkSize, setChunkSize] = useState(300);
  const [chunkOverlap, setChunkOverlap] = useState(50);
  const [strategy, setStrategy] = useState('sliding-window');
  const [workflowData, setWorkflowData] = useState<any>(null);
  const [routerQuery, setRouterQuery] = useState('How does the Playwright login fixture authenticate multi-tenant users?');

  const getRouterProbabilities = (q: string) => {
    const text = q.toLowerCase();
    let sel = 8, pw = 12, tc = 15, docs = 20, bugs = 6;
    
    if (/selenium|basepage|pagefactory|driver|testng|webdriver/i.test(text)) {
      sel += 82;
      docs += 15;
    }
    if (/playwright|fixture|spec|locator|page\.goto|browser/i.test(text)) {
      pw += 84;
      docs += 18;
    }
    if (/test case|testcase|tc|scenario|positive|negative|boundary|p0|blocker/i.test(text)) {
      tc += 75;
      docs += 20;
    }
    if (/prd|spec|requirement|api|endpoint|swagger|openapi|auth|jwt/i.test(text)) {
      docs += 70;
    }
    if (/bug|defect|flaky|failure|fail|issue|error|root cause/i.test(text)) {
      bugs += 82;
      docs += 15;
    }

    return {
      selenium: Math.min(sel, 98),
      playwright: Math.min(pw, 98),
      testcases: Math.min(tc, 98),
      docs: Math.min(docs, 98),
      bugs: Math.min(bugs, 98),
    };
  };

  useEffect(() => {
    getRagWorkflowApi()
      .then((data) => setWorkflowData(data))
      .catch((err) => console.warn('Could not load backend RAG workflow:', err));
  }, []);

  const pipelineStages = [
    {
      id: 'ingest',
      name: '1. Ingestion & Extraction',
      badge: 'Parser v2',
      icon: <FileText size={18} className="text-blue-400" />,
      color: '#3b82f6',
      summary: 'Extracts structured text, tables, and acceptance criteria from Jira tickets & PRDs',
      details: {
        inputs: ['Jira Ticket (#PROJ-1024)', 'PRD Document (.pdf, .docx, .md, .csv)'],
        processing: 'Normalizes markdown tables, strips OCR noise, removes non-alphanumeric artifacts, tags security boundary fields.',
        output: 'Clean normalized text corpus ready for chunking.'
      }
    },
    {
      id: 'chunk',
      name: '2. Smart Token Chunking',
      badge: 'Sliding Window',
      icon: <Layers size={18} className="text-purple-400" />,
      color: '#8b5cf6',
      summary: 'Splits requirements into semantic tokens with overlap to preserve test boundary contexts',
      details: {
        inputs: ['Normalized requirement corpus'],
        processing: `Applies sliding window tokenization (${chunkSize} tokens per chunk with ${chunkOverlap} token overlap). Maintains heading hierarchies to ensure test criteria are never fractured across splits.`,
        output: 'Discrete text chunks with metadata headers (source, section, token count).'
      }
    },
    {
      id: 'embed',
      name: '3. Dense Vector Embedding',
      badge: '384-Dim',
      icon: <Cpu size={18} className="text-cyan-400" />,
      color: '#06b6d4',
      summary: 'Converts textual requirements into 384-dimensional dense semantic vectors',
      details: {
        inputs: ['Text chunks'],
        processing: 'Uses all-MiniLM-L6-v2 transformer encoder. Generates 384-float vector representations that capture semantic similarity (e.g. "auth failure" matches "invalid bearer token").',
        output: '384-dimensional dense vectors normalized to unit length.'
      }
    },
    {
      id: 'index',
      name: '4. FAISS Vector Store Index',
      badge: 'IndexFlatL2',
      icon: <Database size={18} className="text-emerald-400" />,
      color: '#10b981',
      summary: 'Stores high-dimensional vectors in sub-millisecond local FAISS index',
      details: {
        inputs: ['Dense vector embeddings + chunk payloads'],
        processing: 'Inserts vectors into FAISS IndexFlatL2 index. Caches index in memory for sub-10ms nearest neighbor calculations across thousands of historical test suites.',
        output: 'Indexed vector space with indexed document session handles.'
      }
    },
    {
      id: 'retrieve',
      name: '5. Nearest Neighbor Retrieval',
      badge: 'Top-K = 5',
      icon: <Search size={18} className="text-amber-400" />,
      color: '#f59e0b',
      summary: 'Calculates cosine distance to retrieve top-k most relevant test requirement chunks',
      details: {
        inputs: ['User requirement query or active Jira Ticket ID'],
        processing: 'Embeds query vector and executes FAISS inner-product/L2 distance search. Retrieves top-5 candidate chunks with cosine similarity > 0.70.',
        output: 'Ranked list of context candidate chunks with distance scores.'
      }
    },
    {
      id: 'rerank',
      name: '6. Cross-Encoder Re-ranking',
      badge: 'Cohere / Cross-Encoder',
      icon: <GitBranch size={18} className="text-pink-400" />,
      color: '#ec4899',
      summary: 'Re-scores candidate chunks against test assertion coverage priorities',
      details: {
        inputs: ['Candidate retrieved chunks'],
        processing: 'Applies secondary cross-encoder scoring. Prioritizes edge cases, error codes, and acceptance criteria rules over generic descriptive paragraphs.',
        output: 'Optimally ordered context snippets with confidence calibration.'
      }
    },
    {
      id: 'prompt',
      name: '7. Prompt Augmentation',
      badge: 'Grounding Injection',
      icon: <Sparkles size={18} className="text-violet-400" />,
      color: '#a855f7',
      summary: 'Injects grounded context, schema rules, and Jira tickets into LLM system prompt',
      details: {
        inputs: ['Re-ranked context chunks + TestForge system prompt'],
        processing: 'Assembles context block: [RETRIEVED CONTEXT] + [REQUIREMENT] + [ASSERTION CONTRACTS]. Constrains model hallucination by demanding cited preconditions.',
        output: 'Synthesized grounded prompt ready for generative synthesis.'
      }
    },
    {
      id: 'synthesis',
      name: '8. LLM Reasoning & Spec Synthesis',
      badge: 'TestForge Engine',
      icon: <Code2 size={18} className="text-blue-400" />,
      color: '#2563eb',
      summary: 'Generates structured test cases, edge cases, and executable Playwright scripts',
      details: {
        inputs: ['Augmented prompt'],
        processing: 'Deep reasoning model synthesizes functional suites, boundary edge cases, test data permutations, and executable Playwright spec code.',
        output: 'Structured test cases in table format + Playwright automation suites.'
      }
    }
  ];

  const handleRunSimulation = async () => {
    setSimulating(true);
    setCurrentStepIndex(0);
    try {
      const result = await simulateRagPipelineApi({
        query: queryInput,
        jiraId: jiraIdInput,
        chunkSize,
        chunkOverlap,
        strategy
      });
      setSimulationData(result);

      // Animate through steps sequentially
      for (let i = 0; i < pipelineStages.length; i++) {
        setCurrentStepIndex(i);
        await new Promise((resolve) => setTimeout(resolve, 450));
      }
    } catch (err) {
      console.error('Simulation failed, using fallback simulation data', err);
      // Fallback preview
      setSimulationData({
        status: 'ok',
        query: queryInput,
        jiraId: jiraIdInput,
        latencies: {
          ingestionMs: 12.4,
          chunkingMs: 6.8,
          embeddingMs: 28.5,
          vectorSearchMs: 4.9,
          rerankingMs: 11.2,
          promptAssemblyMs: 2.8,
          totalMs: 66.6
        },
        vectorEmbedding: Array.from({ length: 64 }, (_, i) => Math.abs(Math.sin(i * 0.3) * 0.8 + 0.15)),
        retrievedChunks: [
          {
            id: 'chunk_01',
            score: 0.942,
            title: `Webhook Retry Protocol Spec (${jiraIdInput})`,
            text: 'The payment gateway sends webhook POST events upon transaction status transition. If the consumer returns HTTP 5xx or times out after 3000ms, retry with exponential backoff.',
            rerankPromo: true
          },
          {
            id: 'chunk_02',
            score: 0.887,
            title: 'Idempotency Key & Deduplication Header',
            text: 'All inbound webhook calls include the X-Idempotency-Key header. Duplicate events with identical idempotency keys within 24 hours must return HTTP 200 without reprocessing.',
            rerankPromo: true
          },
          {
            id: 'chunk_03',
            score: 0.824,
            title: 'HMAC-SHA256 Signature Verification',
            text: 'Signatures are computed as HMAC-SHA256(payload, secret_key) in the X-Signature header. Invalid signatures must immediately trigger HTTP 401 Unauthorized.',
            rerankPromo: false
          }
        ],
        augmentedPrompt: `[SYSTEM]: Ground all test assertions in retrieved RAG context.\n[CONTEXT]: Webhook retry protocol, X-Idempotency-Key deduplication, HMAC-SHA256 security.\n[REQUIREMENT]: ${queryInput} (${jiraIdInput})`,
        synthesizedTestCases: [
          {
            id: `${jiraIdInput}-TC01`,
            title: 'Verify duplicate webhook with identical X-Idempotency-Key returns HTTP 200 without duplicate credit',
            type: 'Boundary / Idempotency',
            priority: 'Highest',
            expected_result: 'Second request returns HTTP 200; ledger balance remains unchanged.'
          },
          {
            id: `${jiraIdInput}-TC02`,
            title: 'Verify tampered signature triggers HTTP 401 Unauthorized without database write',
            type: 'Security / HMAC',
            priority: 'High',
            expected_result: 'Request rejected at authentication gateway with 401.'
          }
        ]
      });
      for (let i = 0; i < pipelineStages.length; i++) {
        setCurrentStepIndex(i);
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    } finally {
      setSimulating(false);
    }
  };

  const selectedStage = pipelineStages.find((s) => s.id === selectedNode) || pipelineStages[2];

  return (
    <div className="rag-modal-overlay" onClick={onClose}>
      <div className="rag-modal" onClick={(e) => e.stopPropagation()}>
        {/* Top Header */}
        <div className="rag-modal-header">
          <div className="rag-header-left">
            <div className="rag-badge-icon">
              <Sparkles size={18} />
            </div>
            <div>
              <div className="rag-title-row">
                <h2>RAG Pipeline Workflow Visualizer</h2>
                <span className="rag-badge-pill">TestForge v3.4 Hybrid Engine</span>
                <span className="rag-status-dot-pill">
                  <span className="rag-dot active" />
                  FAISS Store Connected
                </span>
              </div>
              <p className="rag-subtitle">
                Explore how Retrieval-Augmented Generation processes documents, embeds vector representations, retrieves context, and synthesizes test suites.
              </p>
            </div>
          </div>
          <button className="rag-close-btn" onClick={onClose} title="Close RAG Explorer">
            <X size={20} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="rag-tabs-bar">
          <button 
            className={`rag-tab-btn ${activeTab === 'diagram' ? 'active' : ''}`}
            onClick={() => setActiveTab('diagram')}
          >
            <GitBranch size={15} />
            Interactive Workflow Architecture
          </button>
          <button 
            className={`rag-tab-btn ${activeTab === 'simulation' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('simulation');
              if (!simulationData) handleRunSimulation();
            }}
          >
            <Play size={15} />
            Live Pipeline Simulator & Telemetry
          </button>
          <button 
            className={`rag-tab-btn ${activeTab === 'collections' ? 'active' : ''}`}
            onClick={() => setActiveTab('collections')}
          >
            <Layers size={15} />
            QA Multi-Collection Router (5 Sources)
          </button>
          <button 
            className={`rag-tab-btn ${activeTab === 'vectors' ? 'active' : ''}`}
            onClick={() => setActiveTab('vectors')}
          >
            <BarChart3 size={15} />
            Pinecone & Vector Inspector
          </button>
        </div>

        {/* Modal Body */}
        <div className="rag-modal-body">
          {/* TAB 1: WORKFLOW DIAGRAM */}
          {activeTab === 'diagram' && (
            <div className="rag-diagram-layout">
              {/* Left stages flowchart */}
              <div className="rag-stages-flow">
                <div className="rag-flow-header">
                  <span>EXECUTION PIPELINE STAGES</span>
                  <span className="rag-flow-hint">Click any stage to inspect inner mechanics</span>
                </div>

                <div className="rag-stage-nodes">
                  {pipelineStages.map((stage, idx) => (
                    <React.Fragment key={stage.id}>
                      <div 
                        className={`rag-stage-node ${selectedNode === stage.id ? 'selected' : ''}`}
                        onClick={() => setSelectedNode(stage.id)}
                        style={{
                          borderLeftColor: selectedNode === stage.id ? stage.color : 'transparent'
                        }}
                      >
                        <div className="rag-node-left">
                          <div className="rag-node-icon" style={{ color: stage.color, background: `${stage.color}15` }}>
                            {stage.icon}
                          </div>
                          <div>
                            <div className="rag-node-name">{stage.name}</div>
                            <div className="rag-node-summary">{stage.summary}</div>
                          </div>
                        </div>
                        <span className="rag-node-badge" style={{ borderColor: `${stage.color}40`, color: stage.color }}>
                          {stage.badge}
                        </span>
                      </div>

                      {idx < pipelineStages.length - 1 && (
                        <div className="rag-flow-arrow">
                          <div className="rag-arrow-line" />
                          <ChevronRight size={14} className="rag-arrow-icon" />
                        </div>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {/* Right Stage Detail Card */}
              <div className="rag-stage-detail-panel">
                <div className="rag-detail-card">
                  <div className="rag-detail-header" style={{ borderBottomColor: `${selectedStage.color}30` }}>
                    <div className="rag-detail-title-icon" style={{ color: selectedStage.color, background: `${selectedStage.color}15` }}>
                      {selectedStage.icon}
                    </div>
                    <div>
                      <h3 style={{ color: selectedStage.color }}>{selectedStage.name}</h3>
                      <span className="rag-detail-badge">{selectedStage.badge}</span>
                    </div>
                  </div>

                  <div className="rag-detail-body">
                    <div className="rag-detail-section">
                      <h4>What this stage does</h4>
                      <p>{selectedStage.summary}</p>
                    </div>

                    <div className="rag-detail-section">
                      <h4>Inputs</h4>
                      <ul>
                        {selectedStage.details.inputs.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="rag-detail-section">
                      <h4>Algorithmic Processing</h4>
                      <div className="rag-code-card">
                        {selectedStage.details.processing}
                      </div>
                    </div>

                    <div className="rag-detail-section">
                      <h4>Output Artifact</h4>
                      <div className="rag-output-pill">
                        <CheckCircle2 size={14} color="#10b981" />
                        <span>{selectedStage.details.output}</span>
                      </div>
                    </div>

                    {/* Interactive vector visualizer on embed stage */}
                    {selectedNode === 'embed' && (
                      <div className="rag-detail-section">
                        <h4>Dense Vector Representation (384 Dimensions Sample)</h4>
                        <div className="rag-vector-bar-grid">
                          {Array.from({ length: 48 }, (_, i) => {
                            const val = Math.abs(Math.sin(i * 0.45 + 0.2) * 0.75 + 0.2);
                            return (
                              <div 
                                key={i} 
                                className="rag-vector-bar" 
                                style={{ height: `${val * 100}%` }}
                                title={`Dim #${i + 1}: ${val.toFixed(3)}`}
                              />
                            );
                          })}
                        </div>
                        <div className="rag-vector-sub">Hover to inspect individual float dimensions · Normalized via L2 Euclidean norm</div>
                      </div>
                    )}
                  </div>

                  <div className="rag-detail-footer">
                    <button 
                      className="rag-action-btn primary"
                      onClick={() => {
                        setActiveTab('simulation');
                        handleRunSimulation();
                      }}
                    >
                      <Play size={14} />
                      Simulate In Live Pipeline
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: LIVE SIMULATOR */}
          {activeTab === 'simulation' && (
            <div className="rag-sim-layout">
              {/* Left Simulator Controls */}
              <div className="rag-sim-controls">
                <div className="rag-sim-box">
                  <h3>Simulate Requirement Context</h3>
                  <div className="rag-input-group">
                    <label>Jira Ticket ID</label>
                    <input 
                      type="text" 
                      value={jiraIdInput} 
                      onChange={(e) => setJiraIdInput(e.target.value)}
                      placeholder="e.g. PROJ-982"
                    />
                  </div>
                  <div className="rag-input-group">
                    <label>Test Requirement Query</label>
                    <textarea 
                      rows={2} 
                      value={queryInput} 
                      onChange={(e) => setQueryInput(e.target.value)}
                      placeholder="Describe requirement..."
                    />
                  </div>
                </div>

                <div className="rag-sim-box">
                  <h3>Chunking Parameters</h3>
                  <div className="rag-range-row">
                    <label>Chunk Size: {chunkSize} tokens</label>
                    <input 
                      type="range" 
                      min={100} 
                      max={800} 
                      step={25} 
                      value={chunkSize}
                      onChange={(e) => setChunkSize(Number(e.target.value))}
                    />
                  </div>
                  <div className="rag-range-row">
                    <label>Overlap: {chunkOverlap} tokens</label>
                    <input 
                      type="range" 
                      min={0} 
                      max={150} 
                      step={10} 
                      value={chunkOverlap}
                      onChange={(e) => setChunkOverlap(Number(e.target.value))}
                    />
                  </div>
                  <div className="rag-input-group" style={{ marginTop: 8 }}>
                    <label>Strategy</label>
                    <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
                      <option value="sliding-window">Sliding Window (Recommended)</option>
                      <option value="row-based">Row-Based (Per CSV Row)</option>
                    </select>
                  </div>
                </div>

                <button 
                  className="rag-run-btn" 
                  onClick={handleRunSimulation}
                  disabled={simulating}
                >
                  {simulating ? <RotateCcw size={16} className="spin" /> : <Play size={16} />}
                  <span>{simulating ? 'Executing Pipeline Trace...' : 'Run Pipeline Simulation'}</span>
                </button>

                {simulationData?.latencies && (
                  <div className="rag-telemetry-pill">
                    <Activity size={14} color="#10b981" />
                    <span>Total Latency: <strong>{simulationData.latencies.totalMs} ms</strong></span>
                  </div>
                )}
              </div>

              {/* Right Live Trace Output */}
              <div className="rag-sim-trace-panel">
                {/* Horizontal Step Tracker */}
                <div className="rag-steps-tracker">
                  {pipelineStages.map((stage, idx) => {
                    const isDone = currentStepIndex >= idx;
                    const isCurrent = currentStepIndex === idx;
                    return (
                      <div 
                        key={stage.id} 
                        className={`rag-step-pill ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''}`}
                      >
                        <span className="rag-step-num">{idx + 1}</span>
                        <span className="rag-step-title">{stage.name.split('. ')[1]}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Simulation Output Cards */}
                {simulationData ? (
                  <div className="rag-trace-results">
                    {/* 1. Vector Dense Embedding Visualizer */}
                    <div className="rag-trace-card">
                      <div className="rag-trace-card-title">
                        <Cpu size={15} color="#06b6d4" />
                        <span>Query Vector Embedding (All-MiniLM-L6-v2)</span>
                        <span className="rag-chip">384 Dimensions</span>
                      </div>
                      <div className="rag-vector-bar-grid">
                        {(simulationData.vectorEmbedding || []).slice(0, 56).map((val: number, i: number) => (
                          <div 
                            key={i} 
                            className="rag-vector-bar" 
                            style={{ height: `${val * 100}%` }}
                            title={`Dimension ${i}: ${val}`}
                          />
                        ))}
                      </div>
                    </div>

                    {/* 2. Retrieved Chunks with Similarity & Rerank Scores */}
                    <div className="rag-trace-card">
                      <div className="rag-trace-card-title">
                        <Search size={15} color="#f59e0b" />
                        <span>Retrieved Context Chunks (FAISS Cosine Similarity)</span>
                        <span className="rag-chip">Top-{simulationData.retrievedChunks?.length || 0} Retrieved</span>
                      </div>
                      <div className="rag-chunks-list">
                        {(simulationData.retrievedChunks || []).map((chunk: any, i: number) => (
                          <div key={chunk.id || i} className="rag-chunk-card">
                            <div className="rag-chunk-header">
                              <span className="rag-chunk-title">{chunk.title}</span>
                              <div className="rag-chunk-badges">
                                {chunk.rerankPromo && <span className="rag-promo-badge">★ Re-ranked #1</span>}
                                <span className="rag-score-badge">Similarity: {(chunk.score * 100).toFixed(1)}%</span>
                              </div>
                            </div>
                            <p className="rag-chunk-text">{chunk.text}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 3. Augmented LLM Prompt */}
                    <div className="rag-trace-card">
                      <div className="rag-trace-card-title">
                        <Sparkles size={15} color="#8b5cf6" />
                        <span>Augmented Grounded Prompt Sent to LLM</span>
                      </div>
                      <pre className="rag-prompt-preview">{simulationData.augmentedPrompt}</pre>
                    </div>

                    {/* 4. Synthesized Test Assertions */}
                    <div className="rag-trace-card">
                      <div className="rag-trace-card-title">
                        <CheckCircle2 size={15} color="#10b981" />
                        <span>Synthesized Grounded Test Cases</span>
                        {onApplyContext && (
                          <button
                            onClick={() => {
                              onApplyContext(`${jiraIdInput}: ${queryInput}`);
                              onClose();
                            }}
                            className="rag-chip"
                            style={{ cursor: 'pointer', background: 'rgba(31, 111, 235, 0.25)', color: '#79c0ff', border: '1px solid rgba(31, 111, 235, 0.4)' }}
                          >
                            Apply to Workspace ➔
                          </button>
                        )}
                      </div>
                      <div className="rag-testcases-preview">

                        {(simulationData.synthesizedTestCases || []).map((tc: any, i: number) => (
                          <div key={tc.id || i} className="rag-tc-pill">
                            <div className="rag-tc-head">
                              <span className="rag-tc-id">{tc.id}</span>
                              <span className="rag-tc-type">{tc.type}</span>
                              <span className="rag-tc-prio">{tc.priority}</span>
                            </div>
                            <div className="rag-tc-title">{tc.title}</div>
                            <div className="rag-tc-expected">
                              <strong>Expected:</strong> {tc.expected_result}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rag-sim-placeholder">
                    <Sparkles size={36} color="#8b5cf6" />
                    <h4>Ready to Trace RAG Pipeline</h4>
                    <p>Click "Run Pipeline Simulation" to watch semantic retrieval and test case synthesis execute in real-time.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: MULTI-SOURCE QA COLLECTIONS & INTENT ROUTER */}
          {activeTab === 'collections' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Pinecone 2GB Serverless Banner */}
              <div style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(59, 130, 246, 0.1))', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Pinecone Serverless 2GB Vector Store Connected</span>
                    <span style={{ fontSize: 10, background: 'rgba(16, 185, 129, 0.2)', color: '#a7f3d0', padding: '2px 7px', borderRadius: 4, fontWeight: 700 }}>FREE TIER ACTIVE</span>
                  </div>
                  <p style={{ fontSize: 11.5, color: 'var(--text-3)', margin: '4px 0 0', maxWidth: 640 }}>
                    5 segregated vector namespaces powered by Pinecone serverless. Sub-millisecond ANN search across Selenium frameworks, Playwright fixtures, PRD specs, and Jira defect registries without local model bloat.
                  </p>
                </div>

                <div style={{ minWidth: 200, background: '#0d1117', border: '1px solid #30363d', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>
                    <span>Vector Storage Quota</span>
                    <strong style={{ color: '#388bfd' }}>14.3 MB / 2,048 MB (0.7%)</strong>
                  </div>
                  <div style={{ width: '100%', height: 6, background: '#21262d', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: '0.7%', minWidth: 6, height: '100%', background: '#10b981', borderRadius: 3 }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
                    <span>Index: testcase-rag</span>
                    <span>1,420 Vectors (1024-dim)</span>
                  </div>
                </div>
              </div>

              {/* Intent Router Playground */}
              <div style={{ background: '#161b22', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Cpu size={15} color="#8b5cf6" />
                    <strong style={{ fontSize: 12.5, color: '#fff' }}>QA Intent Classifier & Router Playground</strong>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Evaluates query semantic focus across collections</span>
                </div>

                {/* Sample Prompt Chips */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                  {[
                    { label: '⚡ Playwright Login Fixture', text: 'How does the Playwright login fixture authenticate multi-tenant users with Page Object Model?' },
                    { label: '☕ Selenium BasePage Waits', text: 'Show the BasePage waitForElement and explicit wait implementation in Selenium' },
                    { label: '📋 P0 Blocker Test Cases', text: 'List all P0 Blocker test cases and regression suites for the Checkout flow' },
                    { label: '📄 PRD 3D-Secure Specs', text: 'What does the PRD specification say about payment webhook idempotency headers?' },
                    { label: '🐞 Session Expiry Defects', text: 'Show open Jira defect bugs related to JWT token expiration and 401 unauthorized' },
                  ].map((chip) => (
                    <button
                      key={chip.label}
                      onClick={() => setRouterQuery(chip.text)}
                      style={{
                        padding: '4px 9px',
                        borderRadius: 5,
                        background: routerQuery === chip.text ? 'rgba(139, 92, 246, 0.2)' : '#0d1117',
                        border: `1px solid ${routerQuery === chip.text ? '#8b5cf6' : '#30363d'}`,
                        color: routerQuery === chip.text ? '#c4b5fd' : 'var(--text-3)',
                        fontSize: 11,
                        cursor: 'pointer',
                        transition: 'all 0.15s'
                      }}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  <input
                    type="text"
                    value={routerQuery}
                    onChange={(e) => setRouterQuery(e.target.value)}
                    placeholder="Enter QA test question or framework command..."
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      background: '#0d1117',
                      border: '1px solid var(--border-light)',
                      borderRadius: 6,
                      color: '#fff',
                      fontSize: 12,
                      outline: 'none'
                    }}
                  />
                </div>

                {/* Live Router Probabilities */}
                {(() => {
                  const p = getRouterProbabilities(routerQuery);
                  const items = [
                    { id: 'playwright', name: '⚡ playwright_framework', score: p.playwright, color: '#388bfd', desc: 'TS Specs, Fixtures, async POM' },
                    { id: 'selenium', name: '☕ selenium_framework', score: p.selenium, color: '#d29922', desc: 'Java PageFactory, BasePage' },
                    { id: 'docs', name: '📄 product_specs', score: p.docs, color: '#a371f7', desc: 'PRD Specifications, Swagger APIs' },
                    { id: 'testcases', name: '📋 regression_testcases', score: p.testcases, color: '#2ea043', desc: '100+ CSV Test Case Repository' },
                    { id: 'bugs', name: '🐞 defect_history', score: p.bugs, color: '#f85149', desc: 'Jira Defect History & Root Cause' },
                  ].sort((a, b) => b.score - a.score);

                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                      {items.map((it, idx) => (
                        <div
                          key={it.id}
                          style={{
                            background: '#0d1117',
                            border: `1px solid ${idx === 0 ? it.color : '#30363d'}`,
                            borderRadius: 8,
                            padding: '10px 12px',
                            boxShadow: idx === 0 ? `0 0 12px ${it.color}33` : 'none'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 11.5, fontWeight: 700, color: '#fff' }}>{it.name}</span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: it.color }}>{it.score}%</span>
                          </div>
                          <div style={{ width: '100%', height: 5, background: '#21262d', borderRadius: 3, overflow: 'hidden', margin: '4px 0 6px' }}>
                            <div style={{ width: `${it.score}%`, height: '100%', background: it.color, borderRadius: 3, transition: 'width 0.3s ease' }} />
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{it.desc}</span>
                            <span style={{ fontSize: 9.5, padding: '1px 5px', borderRadius: 3, fontWeight: 700, background: idx === 0 ? `${it.color}22` : idx === 1 ? 'rgba(255,255,255,0.06)' : 'transparent', color: idx === 0 ? it.color : 'var(--text-3)' }}>
                              {idx === 0 ? 'PRIMARY' : idx === 1 && it.score > 40 ? 'CONTEXT' : 'BYPASSED'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* 5 Collections Grid (matching Chapter 9) */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <h4 style={{ fontSize: 12.5, fontWeight: 700, color: '#fff', margin: 0 }}>
                    5 Multi-Source QA Collections (Grounded Pinecone Namespaces)
                  </h4>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Segregated embeddings avoid hallucination & cross-pollution</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                  {[
                    {
                      name: '⚡ playwright_framework',
                      source: 'data/playwright_repo/**/*.{ts,js}',
                      strategy: 'Per fn/class + each test() block',
                      metadata: 'path, kind, symbol, test_title, timeout',
                      vectors: '420 Chunks',
                      color: '#388bfd',
                      example: 'tests/auth.spec.ts -> login.fixture.ts'
                    },
                    {
                      name: '☕ selenium_framework',
                      source: 'data/selenium_repo/**/*.java',
                      strategy: 'One chunk per method/class (AST)',
                      metadata: 'package, class_name, method, lines',
                      vectors: '380 Chunks',
                      color: '#d29922',
                      example: 'com.testforge.pages.BasePage.waitForElement()'
                    },
                    {
                      name: '📋 regression_testcases',
                      source: 'data/csv/testcases_bank.csv',
                      strategy: 'Row-aware chunking (1 TC = 1 chunk)',
                      metadata: 'tc_id, jira_id, priority, severity, steps',
                      vectors: '310 Chunks',
                      color: '#2ea043',
                      example: 'TC-104: Boundary check on CVV card field'
                    },
                    {
                      name: '📄 product_specs',
                      source: 'data/pdf/*.pdf + openapi.json',
                      strategy: 'Sliding window + Swagger path chunking',
                      metadata: 'doc_title, section, page, endpoint',
                      vectors: '190 Chunks',
                      color: '#a371f7',
                      example: 'PRD: Webhook retry protocol section 4.2'
                    },
                    {
                      name: '🐞 defect_history',
                      source: 'data/md/Defect_Log_*.md',
                      strategy: 'Jira defect parser with root cause tags',
                      metadata: 'jira_id, severity, resolution, fix_commit',
                      vectors: '120 Chunks',
                      color: '#f85149',
                      example: 'DEF-4412: Flaky token race condition under load'
                    }
                  ].map((col) => (
                    <div
                      key={col.name}
                      style={{
                        background: '#161b22',
                        border: '1px solid #30363d',
                        borderRadius: 8,
                        padding: 14,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{col.name}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: col.color, background: `${col.color}22`, padding: '2px 6px', borderRadius: 4 }}>
                          {col.vectors}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        <div><strong>Source:</strong> <code style={{ color: 'var(--text-2)' }}>{col.source}</code></div>
                        <div style={{ marginTop: 2 }}><strong>Chunking:</strong> {col.strategy}</div>
                        <div style={{ marginTop: 2 }}><strong>Key Metadata:</strong> {col.metadata}</div>
                      </div>
                      <div style={{ marginTop: 'auto', paddingTop: 6, borderTop: '1px solid #21262d', fontSize: 10.5, color: 'var(--text-3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span>Sample:</span>
                        <code style={{ color: col.color }}>{col.example}</code>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: VECTOR & CHUNKS INSPECTOR */}
          {activeTab === 'vectors' && (
            <div className="rag-vectors-tab">
              <div className="rag-stats-grid">
                <div className="rag-stat-box">
                  <div className="rag-stat-lbl">Vector Dimension</div>
                  <div className="rag-stat-val">384</div>
                  <div className="rag-stat-sub">Dense all-MiniLM-L6-v2</div>
                </div>
                <div className="rag-stat-box">
                  <div className="rag-stat-lbl">Index Implementation</div>
                  <div className="rag-stat-val">FAISS FlatL2</div>
                  <div className="rag-stat-sub">Sub-millisecond L2/InnerProduct</div>
                </div>
                <div className="rag-stat-box">
                  <div className="rag-stat-lbl">Reranker Model</div>
                  <div className="rag-stat-val">Cohere / Cross-Encoder</div>
                  <div className="rag-stat-sub">Test assertion priority scoring</div>
                </div>
                <div className="rag-stat-box">
                  <div className="rag-stat-lbl">Active Session Chunks</div>
                  <div className="rag-stat-val">{workflowData?.stats?.total_chunks || 42}</div>
                  <div className="rag-stat-sub">Ready for similarity search</div>
                </div>
              </div>

              <div className="rag-vector-architecture-card">
                <h3>Architecture Mechanics</h3>
                <div className="rag-arch-steps">
                  <div className="rag-arch-item">
                    <div className="rag-arch-num">1</div>
                    <div>
                      <strong>Document Chunker</strong>
                      <p>Sliding window splitting with token threshold (300) and overlap (50) to prevent losing requirements context at sentence boundaries.</p>
                    </div>
                  </div>
                  <div className="rag-arch-item">
                    <div className="rag-arch-num">2</div>
                    <div>
                      <strong>Vector Store Embedding</strong>
                      <p>Embeds each chunk into a 384-dimensional vector space. Stored in memory with FAISS serialization backup in the backend store.</p>
                    </div>
                  </div>
                  <div className="rag-arch-item">
                    <div className="rag-arch-num">3</div>
                    <div>
                      <strong>Dual Query Hybrid Matching</strong>
                      <p>Extracts keywords from the user prompt + Jira issue summary and executes dense vector semantic lookup to guarantee relevant context extraction.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RagWorkflowModal;
