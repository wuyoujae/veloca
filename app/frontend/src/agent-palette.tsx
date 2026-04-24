import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEvent
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  Check,
  ChevronDown,
  Copy,
  File,
  FileCode,
  FileText,
  Globe,
  Hexagon,
  History,
  Image as ImageIcon,
  Mic,
  Paperclip,
  Pencil,
  Plus,
  Sparkles,
  Square,
  Table2,
  Undo2,
  X,
  Zap,
  type LucideIcon
} from 'lucide-react';

export interface AgentPaletteAnchor {
  left: number;
  mode: 'center' | 'selection';
  top: number;
  width: number;
}

type AgentModelId = 'lite' | 'pro' | 'ultra';
type AgentAttachmentStatus = 'uploading' | 'parsing' | 'recording' | 'ready';
type AgentPopover = 'model' | 'plus' | 'session' | null;

interface AgentAttachment {
  id: string;
  mimeType: string;
  name: string;
  status: AgentAttachmentStatus;
}

interface AgentConversation {
  answer: string;
  attachments: AgentAttachment[];
  id: string;
  model: AgentModelId;
  prompt: string;
  webSearch: boolean;
}

interface AgentSession {
  id: string;
  messages: AgentConversation[];
  name: string;
}

interface AgentEditingState {
  attachments: AgentAttachment[];
  messageId: string;
  prompt: string;
}

interface AgentPaletteProps {
  onCanvasClose?: () => void;
  onCanvasOpen?: () => void;
  onToast?: (toast: { description: string; title: string; type: 'info' | 'success' }) => void;
  position: AgentPaletteAnchor;
  visible: boolean;
}

const agentModels: Record<
  AgentModelId,
  {
    className: string;
    Icon: LucideIcon;
    label: string;
  }
> = {
  lite: {
    className: 'lite',
    Icon: Zap,
    label: 'Lite'
  },
  pro: {
    className: 'pro',
    Icon: Sparkles,
    label: 'Pro'
  },
  ultra: {
    className: 'ultra',
    Icon: Hexagon,
    label: 'Ultra'
  }
};

const attachmentStatusLabel: Record<AgentAttachmentStatus, string> = {
  uploading: 'Uploading',
  parsing: 'Parsing',
  recording: 'Recording',
  ready: 'Ready'
};

const createAgentId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function AgentPalette({ onCanvasClose, onCanvasOpen, onToast, position, visible }: AgentPaletteProps): JSX.Element {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [model, setModel] = useState<AgentModelId>('lite');
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [popover, setPopover] = useState<AgentPopover>(null);
  const [voiceMode, setVoiceMode] = useState<'idle' | 'listening' | 'recognizing'>('idle');
  const [inlineDictating, setInlineDictating] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [showScrollLatest, setShowScrollLatest] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AgentEditingState | null>(null);
  const [sessions, setSessions] = useState<AgentSession[]>([
    {
      id: 'session-1',
      messages: [],
      name: 'Session 1'
    }
  ]);
  const [activeSessionId, setActiveSessionId] = useState('session-1');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<number[]>([]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? sessions[0],
    [activeSessionId, sessions]
  );
  const activeMessages = activeSession?.messages ?? [];
  const hasHistory = activeMessages.length > 0;
  const activeModel = agentModels[model];
  const ActiveModelIcon = activeModel.Icon;

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      setPopover(null);
      setVoiceMode('idle');
      setInlineDictating(false);
      return;
    }

    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const closePopover = (event: globalThis.MouseEvent) => {
      if (!overlayRef.current?.contains(event.target as Node | null)) {
        setPopover(null);
      }
    };

    document.addEventListener('mousedown', closePopover);
    return () => document.removeEventListener('mousedown', closePopover);
  }, [visible]);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = 'auto';
    const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight) || 25.6;
    const maxHeight = lineHeight * 4;
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [input, visible]);

  useEffect(() => {
    if (!canvasOpen) {
      setShowScrollLatest(false);
      return;
    }

    window.requestAnimationFrame(checkCanvasScroll);
  }, [activeMessages.length, canvasOpen]);

  const pushTimer = (timer: number) => {
    timersRef.current.push(timer);
  };

  const updateActiveSession = (updater: (session: AgentSession) => AgentSession) => {
    setSessions((current) => current.map((session) => (session.id === activeSessionId ? updater(session) : session)));
  };

  const checkCanvasScroll = () => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const papers = canvas.querySelectorAll<HTMLElement>('.agent-qa-paper');
    const latestPaper = papers.item(papers.length - 1);
    const isBeforeLatestPaper = latestPaper ? canvas.scrollTop < latestPaper.offsetTop - 80 : false;

    setShowScrollLatest(activeMessages.length > 1 && isBeforeLatestPaper);
  };

  const scrollToLatest = () => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const papers = canvas.querySelectorAll<HTMLElement>('.agent-qa-paper');
    const latestPaper = papers.item(papers.length - 1);

    canvas.scrollTo({
      behavior: 'smooth',
      top: latestPaper?.offsetTop ?? canvas.scrollHeight
    });
    setShowScrollLatest(false);
  };

  const scheduleScrollToLatest = () => {
    window.setTimeout(scrollToLatest, 60);
  };

  const openCanvas = () => {
    onCanvasOpen?.();
    setCanvasOpen(true);
  };

  const closeCanvas = () => {
    setCanvasOpen(false);
    onCanvasClose?.();
  };

  const selectModel = (nextModel: AgentModelId) => {
    setModel(nextModel);
    setPopover(null);
  };

  const toggleWebSearch = () => {
    setWebSearchEnabled((current) => !current);
    setPopover(null);
  };

  const getAttachmentIcon = (attachment: AgentAttachment): LucideIcon => {
    const lowerName = attachment.name.toLowerCase();

    if (attachment.mimeType.startsWith('image/') || /\.(gif|jpe?g|png|svg|webp)$/.test(lowerName)) {
      return ImageIcon;
    }

    if (/\.(csv|tsv|xlsx?)$/.test(lowerName)) {
      return Table2;
    }

    if (/\.(c|cpp|css|go|html|java|js|json|jsx|py|rs|ts|tsx|vue|xml|yaml|yml)$/.test(lowerName)) {
      return FileCode;
    }

    if (/\.(md|pdf|txt|docx?)$/.test(lowerName)) {
      return FileText;
    }

    return File;
  };

  const scheduleAttachmentStatus = (attachmentId: string, status: AgentAttachmentStatus, delay: number) => {
    const timer = window.setTimeout(() => {
      setAttachments((current) =>
        current.map((attachment) => (attachment.id === attachmentId ? { ...attachment, status } : attachment))
      );
    }, delay);

    pushTimer(timer);
  };

  const addAttachmentFiles = (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    const nextAttachments = files.map((file) => ({
      id: createAgentId('attachment'),
      mimeType: file.type || 'application/octet-stream',
      name: file.name,
      status: 'uploading' as const
    }));

    setAttachments((current) => [...current, ...nextAttachments]);

    nextAttachments.forEach((attachment, index) => {
      const offset = index * 120;
      scheduleAttachmentStatus(attachment.id, 'parsing', 520 + offset);
      scheduleAttachmentStatus(attachment.id, 'recording', 1040 + offset);
      scheduleAttachmentStatus(attachment.id, 'ready', 1560 + offset);
    });
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    addAttachmentFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const removePromptAttachment = (attachmentId: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  };

  const insertTextAtCursor = (text: string) => {
    const textarea = textareaRef.current;

    if (!textarea) {
      setInput((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text));
      return;
    }

    const start = textarea.selectionStart ?? input.length;
    const end = textarea.selectionEnd ?? input.length;
    const prefix = input.slice(0, start);
    const suffix = input.slice(end);
    const needsLeadingSpace = prefix.length > 0 && !/\s$/.test(prefix);
    const needsTrailingSpace = suffix.length > 0 && !/^\s/.test(suffix);
    const insertedText = `${needsLeadingSpace ? ' ' : ''}${text}${needsTrailingSpace ? ' ' : ''}`;
    const nextInput = `${prefix}${insertedText}${suffix}`;
    const nextCursor = start + insertedText.length;

    setInput(nextInput);
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const finishFullVoiceInput = () => {
    setVoiceMode('recognizing');

    const timer = window.setTimeout(() => {
      insertTextAtCursor('请帮我优化这段内容，并保留原来的语气。');
      setVoiceMode('idle');
    }, 680);

    pushTimer(timer);
  };

  const toggleFullVoiceMode = () => {
    if (voiceMode === 'listening') {
      finishFullVoiceInput();
      return;
    }

    if (voiceMode === 'recognizing') {
      return;
    }

    setVoiceMode('listening');
  };

  const toggleInlineDictation = () => {
    if (inlineDictating) {
      insertTextAtCursor('请把这段 Markdown 改得更清晰。');
      setInlineDictating(false);
      return;
    }

    setInlineDictating(true);
  };

  const buildAgentAnswer = (prompt: string, nextModel: AgentModelId, nextAttachments: AgentAttachment[]) => {
    const modelLabel = agentModels[nextModel].label;
    const attachmentSummary = nextAttachments.length
      ? ` I also registered ${nextAttachments.length} attachment${nextAttachments.length > 1 ? 's' : ''} into this turn.`
      : '';

    return `I have received your request with the ${modelLabel} model.${attachmentSummary}

Here is a concise direction:
- Keep the Markdown structure readable and stable.
- Preserve the author's original intent before polishing the language.
- Use the selected context as the main reference for the next edit.`;
  };

  const sendMessage = () => {
    const prompt = input.trim();

    if (!prompt) {
      toggleFullVoiceMode();
      return;
    }

    const messageAttachments = attachments.map((attachment) => ({
      ...attachment,
      status: attachment.status === 'ready' ? attachment.status : ('recording' as const)
    }));
    const nextMessage: AgentConversation = {
      answer: buildAgentAnswer(prompt, model, messageAttachments),
      attachments: messageAttachments,
      id: createAgentId('message'),
      model,
      prompt,
      webSearch: webSearchEnabled
    };

    updateActiveSession((session) => ({
      ...session,
      messages: [...session.messages, nextMessage]
    }));
    setInput('');
    setAttachments([]);
    openCanvas();
    setEditing(null);
    scheduleScrollToLatest();
  };

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    sendMessage();
  };

  const createSession = () => {
    const nextSession: AgentSession = {
      id: createAgentId('session'),
      messages: [],
      name: `Session ${sessions.length + 1}`
    };

    setSessions((current) => [...current, nextSession]);
    setActiveSessionId(nextSession.id);
    closeCanvas();
    setEditing(null);
    setPopover(null);
  };

  const switchSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setEditing(null);
    setPopover(null);
    window.requestAnimationFrame(checkCanvasScroll);
  };

  const startEditMessage = (message: AgentConversation) => {
    setEditing({
      attachments: message.attachments,
      messageId: message.id,
      prompt: message.prompt
    });
  };

  const cancelEditMessage = () => {
    setEditing(null);
  };

  const confirmEditMessage = () => {
    if (!editing) {
      return;
    }

    const prompt = editing.prompt.trim();

    if (!prompt) {
      return;
    }

    updateActiveSession((session) => ({
      ...session,
      messages: session.messages.map((message) =>
        message.id === editing.messageId
          ? {
              ...message,
              answer: buildAgentAnswer(prompt, message.model, editing.attachments),
              attachments: editing.attachments,
              prompt
            }
          : message
      )
    }));
    setEditing(null);
    scheduleScrollToLatest();
  };

  const removeEditingAttachment = (attachmentId: string) => {
    setEditing((current) =>
      current
        ? {
            ...current,
            attachments: current.attachments.filter((attachment) => attachment.id !== attachmentId)
          }
        : current
    );
  };

  const copyMessage = async (message: AgentConversation) => {
    try {
      await navigator.clipboard.writeText(message.prompt);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = message.prompt;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }

    setCopiedMessageId(message.id);
    onToast?.({
      type: 'success',
      title: 'Copied',
      description: 'The user message has been copied.'
    });

    const timer = window.setTimeout(() => setCopiedMessageId(null), 1200);
    pushTimer(timer);
  };

  const overlayStyle = {
    '--agent-left': `${position.left}px`,
    '--agent-top': `${position.top}px`,
    '--agent-width': `${position.width}px`
  } as CSSProperties;

  return (
    <div
      aria-hidden={!visible}
      className={[
        'agent-overlay',
        visible ? 'is-visible' : '',
        canvasOpen ? 'has-open-canvas' : '',
        position.mode === 'center' ? 'is-centered' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      ref={overlayRef}
      style={overlayStyle}
    >
      <section className="agent-prompt-box" aria-label="Veloca Agent">
        <div className="agent-input-wrapper">
          <textarea
            className="agent-prompt-textarea"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handlePromptKeyDown}
            placeholder="Ask Veloca anything..."
            ref={textareaRef}
            rows={1}
            style={{ display: voiceMode === 'idle' ? 'block' : 'none' }}
            value={input}
          />
          <div className={`agent-voice-wave-container${voiceMode !== 'idle' ? ' show' : ''}`}>
            <div className="agent-wave-line">
              {Array.from({ length: 13 }, (_, index) => (
                <span className="agent-wave-bar" key={index} />
              ))}
            </div>
          </div>
        </div>

        {attachments.length > 0 && (
          <div className="agent-prompt-attachments">
            {attachments.map((attachment) => {
              const AttachmentIcon = getAttachmentIcon(attachment);

              return (
                <div className={`agent-attachment-tag ${attachment.status}`} key={attachment.id}>
                  <AttachmentIcon size={14} />
                  <span className="agent-attachment-name">{attachment.name}</span>
                  <span className="agent-attachment-status">{attachmentStatusLabel[attachment.status]}</span>
                  <button
                    className="agent-att-close"
                    type="button"
                    aria-label={`Remove ${attachment.name}`}
                    onClick={() => removePromptAttachment(attachment.id)}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="agent-prompt-toolbar">
          <div className="agent-toolbar-left">
            <button
              className="agent-icon-btn"
              type="button"
              aria-label="Open agent tools"
              onClick={(event) => {
                event.stopPropagation();
                setPopover((current) => (current === 'plus' ? null : 'plus'));
              }}
            >
              <Plus size={18} />
            </button>

            <button
              className={`agent-model-badge ${activeModel.className}`}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setPopover((current) => (current === 'model' ? null : 'model'));
              }}
            >
              <ActiveModelIcon size={14} />
              <span>{activeModel.label}</span>
              <ChevronDown size={12} />
            </button>

            <div className={`agent-popover agent-plus-popover${popover === 'plus' ? ' show' : ''}`}>
              <button
                className={`agent-menu-item${webSearchEnabled ? ' selected' : ''}`}
                type="button"
                onClick={toggleWebSearch}
              >
                <Globe size={16} />
                <span>Web Search</span>
                <Check className="agent-check-icon" size={14} />
              </button>
              <button
                className="agent-menu-item"
                type="button"
                onClick={() => {
                  setPopover(null);
                  fileInputRef.current?.click();
                }}
              >
                <Paperclip size={16} />
                <span>Upload File</span>
              </button>
            </div>

            <div className={`agent-popover agent-model-popover${popover === 'model' ? ' show' : ''}`}>
              {(Object.keys(agentModels) as AgentModelId[]).map((modelId) => {
                const ModelIcon = agentModels[modelId].Icon;

                return (
                  <button
                    className={`agent-menu-item model-${agentModels[modelId].className}${model === modelId ? ' selected' : ''}`}
                    key={modelId}
                    type="button"
                    onClick={() => selectModel(modelId)}
                  >
                    <ModelIcon size={16} />
                    <span>{agentModels[modelId].label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="agent-toolbar-right">
            {hasHistory && !canvasOpen && (
              <button className="agent-icon-btn" type="button" aria-label="Open conversation history" onClick={openCanvas}>
                <History size={18} />
              </button>
            )}
            <button
              className={`agent-icon-btn agent-dictate-btn${inlineDictating ? ' listening' : ''}`}
              type="button"
              title="Dictate Text"
              aria-label="Dictate text into prompt"
              onClick={toggleInlineDictation}
            >
              <Mic size={18} />
            </button>
            <button
              className={`agent-main-action-btn${input.trim() ? ' send' : ' voice'}${voiceMode !== 'idle' ? ' listening' : ''}`}
              type="button"
              aria-label={input.trim() ? 'Send message' : 'Start voice input'}
              onClick={sendMessage}
            >
              {input.trim() ? <ArrowUp size={18} /> : voiceMode === 'idle' ? <AudioLines size={18} /> : <Square size={16} />}
            </button>
          </div>
        </div>

        <input className="agent-file-input" multiple onChange={handleFileInputChange} ref={fileInputRef} type="file" />
      </section>

      <div className={`agent-canvas${canvasOpen ? ' open' : ''}`} ref={canvasRef} onScroll={checkCanvasScroll}>
        <button
          className={`agent-scroll-to-bottom-btn${showScrollLatest ? ' show' : ''}`}
          type="button"
          onClick={scrollToLatest}
        >
          <ArrowDown size={14} />
          <span>Back to latest</span>
        </button>

        <div className="agent-canvas-control">
          <div className="agent-session-control-wrap">
            <button
              className="agent-control-session"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setPopover((current) => (current === 'session' ? null : 'session'));
              }}
            >
              <span>{activeSession?.name ?? 'Session 1'}</span>
              <ChevronDown size={12} />
            </button>
            <div className={`agent-popover agent-session-popover${popover === 'session' ? ' show' : ''}`}>
              <button className="agent-menu-item new-session" type="button" onClick={createSession}>
                <Plus size={14} />
                <span>New Session</span>
              </button>
              <div className="agent-menu-separator" />
              {sessions.map((session) => (
                <button
                  className={`agent-menu-item${session.id === activeSessionId ? ' selected' : ''}`}
                  key={session.id}
                  type="button"
                  onClick={() => switchSession(session.id)}
                >
                  <span>{session.name}</span>
                </button>
              ))}
            </div>
          </div>

          <button className="agent-control-close" type="button" aria-label="Collapse conversation canvas" onClick={closeCanvas}>
            <ChevronDown className="agent-collapse-icon" size={16} />
          </button>
        </div>

        {activeMessages.map((message) => {
          const isEditing = editing?.messageId === message.id;
          const messageAttachments = isEditing ? editing.attachments : message.attachments;

          return (
            <section className="agent-qa-paper" key={message.id}>
              <div className={`agent-user-block${isEditing ? ' is-editing' : ''}`}>
                {isEditing ? (
                  <textarea
                    className="agent-user-bubble agent-user-edit-input"
                    value={editing.prompt}
                    onChange={(event) =>
                      setEditing((current) => (current ? { ...current, prompt: event.target.value } : current))
                    }
                  />
                ) : (
                  <div className="agent-user-bubble">{message.prompt}</div>
                )}

                <div className="agent-user-meta">
                  <div className="agent-bento-grid">
                    {messageAttachments.map((attachment) => {
                      const AttachmentIcon = getAttachmentIcon(attachment);

                      return (
                        <div className="agent-bento-item" key={attachment.id}>
                          <AttachmentIcon size={14} />
                          <span className="agent-bento-name">{attachment.name}</span>
                          {isEditing && (
                            <button
                              className="agent-bento-delete"
                              type="button"
                              aria-label={`Remove ${attachment.name}`}
                              onClick={() => removeEditingAttachment(attachment.id)}
                            >
                              <X size={10} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="agent-msg-actions">
                    {isEditing ? (
                      <>
                        <button type="button" title="Cancel" onClick={cancelEditMessage}>
                          <X size={14} />
                        </button>
                        <button className="confirm" type="button" title="Confirm" onClick={confirmEditMessage}>
                          <Check size={14} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" title="Undo" aria-label="Undo message">
                          <Undo2 size={14} />
                        </button>
                        <button
                          className={copiedMessageId === message.id ? 'copied' : ''}
                          type="button"
                          title="Copy"
                          aria-label="Copy message"
                          onClick={() => void copyMessage(message)}
                        >
                          <Copy size={14} />
                        </button>
                        <button type="button" title="Edit" aria-label="Edit message" onClick={() => startEditMessage(message)}>
                          <Pencil size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="agent-ai-msg">
                {message.webSearch && (
                  <p className="agent-ai-kicker">
                    <Globe size={13} />
                    Web Search context is enabled for this turn.
                  </p>
                )}
                {message.answer.split('\n').map((line, index) => {
                  if (!line.trim()) {
                    return null;
                  }

                  if (line.trim().startsWith('- ')) {
                    return <li key={`${message.id}-line-${index}`}>{line.trim().slice(2)}</li>;
                  }

                  return <p key={`${message.id}-line-${index}`}>{line}</p>;
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
