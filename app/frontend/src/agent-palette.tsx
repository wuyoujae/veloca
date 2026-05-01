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
  AlertCircle,
  ArrowDown,
  ArrowUp,
  AudioLines,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  File,
  FileCode,
  FileInput,
  FilePenLine,
  FileText,
  FolderTree,
  Globe,
  Hexagon,
  History,
  Image as ImageIcon,
  Link2,
  Loader2,
  Mic,
  Paperclip,
  Pencil,
  Play,
  Plus,
  Save,
  Search,
  SearchCode,
  Sparkles,
  Square,
  Table2,
  Terminal,
  Undo2,
  X,
  Zap,
  type LucideIcon
} from 'lucide-react';
import { hydrateMermaidBlocks, renderMarkdownToSafeHtml } from './rich-markdown';

export interface AgentPaletteAnchor {
  left: number;
  mode: 'center' | 'selection';
  top: number;
  width: number;
}

export type AgentWorkspaceType = 'database' | 'filesystem' | 'none';

export interface AgentRuntimeContext {
  brainstormSessionKey?: string;
  currentFilePath?: string;
  selectedText?: string;
  workspaceRootPath?: string;
  workspaceType?: AgentWorkspaceType;
}

type AgentModelId = 'lite' | 'pro' | 'ultra';
type AgentAttachmentStatus = 'uploading' | 'parsing' | 'recording' | 'ready';
type AgentMessageStatus = 'pending' | 'complete' | 'error';
type AgentPopover = 'model' | 'plus' | 'session' | null;
type AgentToolCallStatus = 'running' | 'success' | 'error';
type AgentInteractionStatus = 'open' | 'resolved';
type AgentInteractionKind = 'confirm' | 'input';
type AgentResponsePart =
  | {
      content: string;
      id: string;
      type: 'text';
    }
  | {
      id: string;
      item: AgentToolCallMessage;
      type: 'tool';
    }
  | {
      id: string;
      item: AgentToolCallMessage;
      type: 'thinking';
    }
  | {
      id: string;
      item: AgentInteractionItem;
      type: 'interaction';
    };

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
  interactionItems?: AgentInteractionItem[];
  model: AgentModelId;
  prompt: string;
  responseParts?: AgentResponsePart[];
  status: AgentMessageStatus;
  toolCalls?: AgentToolCallMessage[];
  webSearch: boolean;
}

interface AgentToolCallMessage {
  action: string;
  detail?: string;
  icon: string;
  id: string;
  openable: boolean;
  status: AgentToolCallStatus;
  summary?: string;
}

interface AgentInteractionItem {
  accent?: 'blue' | 'purple';
  description: string;
  icon: string;
  id: string;
  kind: AgentInteractionKind;
  placeholder?: string;
  resolvedText?: string;
  status: AgentInteractionStatus;
  title: string;
}

interface AgentSession {
  id: string;
  messages: AgentConversation[];
  name: string;
}

interface StoredAgentAttachment {
  id?: string;
  mimeType: string;
  name: string;
  status: string;
}

interface StoredAgentConversation {
  answer: string;
  attachments?: StoredAgentAttachment[];
  id: string;
  model: AgentModelId;
  prompt: string;
  status: AgentMessageStatus;
  webSearch: boolean;
}

interface StoredAgentSession {
  id: string;
  messages: StoredAgentConversation[];
  name: string;
}

interface AgentEditingState {
  attachments: AgentAttachment[];
  messageId: string;
  prompt: string;
}

interface AgentPaletteProps {
  context: AgentRuntimeContext;
  onCanvasClose?: () => void;
  onCanvasOpen?: () => void;
  onInsertAnswer?: (answer: string, messageId: string, targetFilePath?: string) => void;
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

const initialAgentSession: AgentSession = {
  id: 'session-1',
  messages: [],
  name: 'Session 1'
};

function normalizeStoredModel(model: string): AgentModelId {
  return model === 'pro' || model === 'ultra' ? model : 'lite';
}

function normalizeStoredStatus(status: string): AgentMessageStatus {
  return status === 'error' || status === 'pending' ? status : 'complete';
}

function normalizeStoredAttachmentStatus(status: string): AgentAttachmentStatus {
  return status === 'uploading' || status === 'parsing' || status === 'recording' ? status : 'ready';
}

function normalizeStoredSession(session: StoredAgentSession): AgentSession {
  return {
    id: session.id,
    messages: session.messages.map((message) => ({
      answer: message.answer,
      attachments: (message.attachments ?? []).map((attachment) => ({
        id: attachment.id ?? createAgentId('attachment'),
        mimeType: attachment.mimeType,
        name: attachment.name,
        status: normalizeStoredAttachmentStatus(attachment.status)
      })),
      id: message.id,
      model: normalizeStoredModel(message.model),
      prompt: message.prompt,
      status: normalizeStoredStatus(message.status),
      webSearch: message.webSearch
    })),
    name: session.name
  };
}

function AgentMarkdown({ content }: { content: string }): JSX.Element {
  const markdownRef = useRef<HTMLDivElement | null>(null);
  const html = useMemo(() => renderMarkdownToSafeHtml(content), [content]);

  useEffect(() => {
    if (!markdownRef.current) {
      return;
    }

    hydrateMermaidBlocks(markdownRef.current);
  }, [html]);

  return <div ref={markdownRef} className="agent-ai-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

const agentSupplementIcons: Record<string, LucideIcon> = {
  alert: AlertCircle,
  brain: Brain,
  'file-pen-line': FilePenLine,
  'file-text': FileText,
  'folder-tree': FolderTree,
  globe: Globe,
  link: Link2,
  play: Play,
  save: Save,
  search: Search,
  'search-code': SearchCode,
  terminal: Terminal,
  'terminal-square': Terminal,
  'git-commit': FileCode
};

function getAgentSupplementIcon(icon: string): LucideIcon {
  return agentSupplementIcons[icon] ?? Sparkles;
}

function appendAgentTextPart(parts: AgentResponsePart[] | undefined, content: string): AgentResponsePart[] {
  const currentParts = parts ?? [];
  const latestPart = currentParts[currentParts.length - 1];

  if (latestPart?.type === 'text') {
    return [
      ...currentParts.slice(0, -1),
      {
        ...latestPart,
        content: latestPart.content + content
      }
    ];
  }

  return [
    ...currentParts,
    {
      content,
      id: createAgentId('answer-part'),
      type: 'text'
    }
  ];
}

function upsertAgentToolCall(
  toolCalls: AgentToolCallMessage[] | undefined,
  nextToolCall: AgentToolCallMessage
): AgentToolCallMessage[] {
  const currentToolCalls = toolCalls ?? [];
  const index = currentToolCalls.findIndex((toolCall) => toolCall.id === nextToolCall.id);

  if (index < 0) {
    return [...currentToolCalls, nextToolCall];
  }

  return currentToolCalls.map((toolCall, currentIndex) => (currentIndex === index ? nextToolCall : toolCall));
}

function upsertAgentItemPart(
  parts: AgentResponsePart[] | undefined,
  type: 'thinking' | 'tool',
  nextItem: AgentToolCallMessage
): AgentResponsePart[] {
  const currentParts = parts ?? [];
  const index = currentParts.findIndex((part) => part.type === type && part.item.id === nextItem.id);

  if (index < 0) {
    return [
      ...currentParts,
      {
        id: nextItem.id,
        item: nextItem,
        type
      }
    ];
  }

  return currentParts.map((part, currentIndex) =>
    currentIndex === index && (part.type === 'thinking' || part.type === 'tool')
      ? {
          ...part,
          item: nextItem
        }
      : part
  );
}

function AgentToolCallItem({
  defaultOpen = false,
  toolCall,
  variant = 'tool'
}: {
  defaultOpen?: boolean;
  toolCall: AgentToolCallMessage;
  variant?: 'thinking' | 'tool';
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const ToolIcon = getAgentSupplementIcon(toolCall.icon);
  const canOpen = toolCall.openable && Boolean(toolCall.detail?.trim());
  const StatusIcon = toolCall.status === 'running' ? Loader2 : toolCall.status === 'error' ? AlertCircle : CheckCircle2;
  const contentId = `agent-tool-detail-${toolCall.id}`;

  return (
    <div className={`agent-tool-call ${variant}${canOpen ? ' interactive' : ''}${open ? ' open' : ''} ${toolCall.status}`}>
      {canOpen ? (
        <button
          className="agent-tool-header"
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((current) => !current)}
        >
          <ToolIcon className="agent-tool-main-icon" size={14} />
          <span className="agent-tool-name">
            {toolCall.action}
            {toolCall.summary ? <span className="agent-tool-summary"> {toolCall.summary}</span> : null}
          </span>
          <StatusIcon className="agent-tool-status-icon" size={14} />
          <ChevronDown className="agent-tool-chevron" size={14} />
        </button>
      ) : (
        <div className="agent-tool-header">
          <ToolIcon className="agent-tool-main-icon" size={14} />
          <span className="agent-tool-name">
            {toolCall.action}
            {toolCall.summary ? <span className="agent-tool-summary"> {toolCall.summary}</span> : null}
          </span>
          <StatusIcon className="agent-tool-status-icon" size={14} />
        </div>
      )}

      {canOpen && (
        <div className="agent-tool-body" id={contentId}>
          <pre>
            <code>{toolCall.detail}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

function AgentInteractionCard({ item }: { item: AgentInteractionItem }): JSX.Element {
  const [resolvedText, setResolvedText] = useState(item.status === 'resolved' ? item.resolvedText ?? 'Action resolved' : '');
  const [value, setValue] = useState('');
  const ActionIcon = getAgentSupplementIcon(item.icon);

  if (resolvedText) {
    return (
      <div className="agent-action-card resolved">
        <div className="agent-action-resolved-msg">
          <CheckCircle2 size={14} />
          <span>{resolvedText}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-action-card">
      <div className="agent-action-content">
        <div className="agent-action-header">
          <ActionIcon className={`agent-action-icon ${item.accent ?? 'blue'}`} size={18} />
          <div>
            <div className="agent-action-title">{item.title}</div>
            <div className="agent-action-desc">{item.description}</div>
          </div>
        </div>

        {item.kind === 'input' && (
          <input
            className="agent-action-input"
            type="text"
            value={value}
            placeholder={item.placeholder}
            onChange={(event) => setValue(event.target.value)}
          />
        )}

        <div className="agent-action-footer">
          <button className="agent-action-btn outline" type="button" onClick={() => setResolvedText('Action cancelled by user')}>
            Cancel
          </button>
          <button
            className="agent-action-btn primary"
            type="button"
            onClick={() => setResolvedText(item.kind === 'input' ? 'Input submitted' : 'Action confirmed')}
          >
            {item.kind === 'input' ? 'Submit' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AgentResponseTimeline({ message }: { message: AgentConversation }): JSX.Element {
  const responseParts = message.responseParts ?? [];
  const hasResponseParts = responseParts.length > 0;

  return (
    <>
      {message.webSearch && (
        <p className="agent-ai-kicker">
          <Globe size={13} />
          Web Search context is enabled for this turn.
        </p>
      )}

      {hasResponseParts
        ? responseParts.map((part) => {
            if (part.type === 'text') {
              return <AgentMarkdown content={part.content} key={part.id} />;
            }

            if (part.type === 'thinking') {
              return <AgentToolCallItem defaultOpen key={part.id} toolCall={part.item} variant="thinking" />;
            }

            if (part.type === 'tool') {
              return <AgentToolCallItem key={part.id} toolCall={part.item} />;
            }

            return <AgentInteractionCard key={part.id} item={part.item} />;
          })
        : message.answer.trim() ? (
            <AgentMarkdown content={message.answer} />
          ) : !message.toolCalls?.length ? (
            <div className="agent-typing-indicator" aria-label="Veloca is typing">
              <span />
              <span />
              <span />
            </div>
          ) : null}

      {!hasResponseParts &&
        Boolean(message.interactionItems?.length) &&
        (message.interactionItems ?? []).map((item) => <AgentInteractionCard key={item.id} item={item} />)}
    </>
  );
}

export function AgentPalette({
  context,
  onCanvasClose,
  onCanvasOpen,
  onInsertAnswer,
  onToast,
  position,
  visible
}: AgentPaletteProps): JSX.Element {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [model, setModel] = useState<AgentModelId>('lite');
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [popover, setPopover] = useState<AgentPopover>(null);
  const [voiceMode, setVoiceMode] = useState<'idle' | 'listening' | 'recognizing'>('idle');
  const [inlineDictating, setInlineDictating] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [showScrollLatest, setShowScrollLatest] = useState(false);
  const [showResumeAutoScroll, setShowResumeAutoScroll] = useState(false);
  const [autoScrollLocked, setAutoScrollLockedState] = useState(false);
  const [canvasControlsVisible, setCanvasControlsVisible] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [copiedAnswerId, setCopiedAnswerId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AgentEditingState | null>(null);
  const [sendingMessageId, setSendingMessageId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AgentSession[]>([initialAgentSession]);
  const [activeSessionId, setActiveSessionId] = useState(initialAgentSession.id);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<number[]>([]);
  const canvasControlsTimerRef = useRef<number | null>(null);
  const autoScrollLockedRef = useRef(false);
  const pointerInsertHandledRef = useRef<string | null>(null);
  const lastCanvasScrollTopRef = useRef(0);
  const programmaticScrollUntilRef = useRef(0);

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
      if (canvasControlsTimerRef.current) {
        window.clearTimeout(canvasControlsTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let canceled = false;

    const loadSessions = async () => {
      const listSessions = window.veloca?.agent.listSessions;

      if (!listSessions) {
        return;
      }

      try {
        const storedSessions = await listSessions(context);

        if (canceled || storedSessions.length === 0) {
          return;
        }

        const nextSessions = storedSessions.map((session) => normalizeStoredSession(session as StoredAgentSession));

        setSessions(nextSessions);
        setActiveSessionId((current) =>
          nextSessions.some((session) => session.id === current)
            ? current
            : nextSessions[nextSessions.length - 1].id
        );
      } catch (error) {
        if (canceled) {
          return;
        }

        onToast?.({
          type: 'info',
          title: 'Agent history unavailable',
          description: error instanceof Error ? error.message : 'Unable to load local Agent sessions.'
        });
      }
    };

    void loadSessions();

    return () => {
      canceled = true;
    };
  }, [context.workspaceRootPath, context.workspaceType]);

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
      setShowResumeAutoScroll(false);
      return;
    }

    window.requestAnimationFrame(updateCanvasScrollState);
  }, [activeMessages.length, canvasOpen, sendingMessageId]);

  const pushTimer = (timer: number) => {
    timersRef.current.push(timer);
  };

  const updateSession = (sessionId: string, updater: (session: AgentSession) => AgentSession) => {
    setSessions((current) => current.map((session) => (session.id === sessionId ? updater(session) : session)));
  };

  const updateActiveSession = (updater: (session: AgentSession) => AgentSession) => {
    updateSession(activeSessionId, updater);
  };

  const setAutoScrollLocked = (locked: boolean) => {
    autoScrollLockedRef.current = locked;
    setAutoScrollLockedState(locked);
  };

  const getCanvasScrollSnapshot = () => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return null;
    }

    const papers = canvas.querySelectorAll<HTMLElement>('.agent-qa-paper');
    const latestPaper = papers.item(papers.length - 1);

    if (!latestPaper) {
      return {
        isAtBottom: true,
        isViewingLatest: true,
        latestTop: 0
      };
    }

    const latestTop = latestPaper.offsetTop;
    const isViewingLatest = canvas.scrollTop >= latestTop - 72;
    const isAtBottom = canvas.scrollHeight - canvas.scrollTop - canvas.clientHeight < 18;

    return {
      isAtBottom,
      isViewingLatest,
      latestTop
    };
  };

  const updateCanvasScrollState = () => {
    const snapshot = getCanvasScrollSnapshot();

    if (!snapshot) {
      return;
    }

    const shouldShowLatest = activeMessages.length > 1 && !snapshot.isViewingLatest;

    setShowScrollLatest(shouldShowLatest);
    setShowResumeAutoScroll(
      Boolean(sendingMessageId) && !shouldShowLatest && snapshot.isViewingLatest && !autoScrollLockedRef.current && !snapshot.isAtBottom
    );

    if (snapshot.isAtBottom && snapshot.isViewingLatest) {
      setAutoScrollLocked(true);
    }
  };

  const clearCanvasControlsTimer = () => {
    if (!canvasControlsTimerRef.current) {
      return;
    }

    window.clearTimeout(canvasControlsTimerRef.current);
    canvasControlsTimerRef.current = null;
  };

  const hideCanvasControls = () => {
    clearCanvasControlsTimer();
    setCanvasControlsVisible(false);
  };

  const scheduleCanvasControlsHide = () => {
    clearCanvasControlsTimer();
    canvasControlsTimerRef.current = window.setTimeout(() => {
      setCanvasControlsVisible(false);
      canvasControlsTimerRef.current = null;
    }, 4000);
  };

  const revealCanvasControls = () => {
    setCanvasControlsVisible(true);
    scheduleCanvasControlsHide();
  };

  const scrollToCanvasBottom = (behavior: ScrollBehavior = 'smooth') => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    programmaticScrollUntilRef.current = Date.now() + (behavior === 'smooth' ? 650 : 120);
    canvas.scrollTo({
      behavior,
      top: canvas.scrollHeight - canvas.clientHeight
    });
  };

  const scrollToLatest = () => {
    setAutoScrollLocked(true);
    setShowScrollLatest(false);
    setShowResumeAutoScroll(false);
    scrollToCanvasBottom('smooth');
    hideCanvasControls();
  };

  const resumeAutoScroll = () => {
    setAutoScrollLocked(true);
    setShowResumeAutoScroll(false);
    scrollToCanvasBottom('smooth');
  };

  const followStreamToBottom = () => {
    if (!autoScrollLockedRef.current) {
      return;
    }

    window.requestAnimationFrame(() => scrollToCanvasBottom('auto'));
  };

  const scheduleScrollToLatest = (lockToBottom = false) => {
    if (lockToBottom) {
      setAutoScrollLocked(true);
    }

    window.setTimeout(() => {
      if (lockToBottom || autoScrollLockedRef.current) {
        scrollToCanvasBottom('smooth');
      }
      updateCanvasScrollState();
    }, 60);
  };

  const handleCanvasScroll = () => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const currentScrollTop = canvas.scrollTop;
    const previousScrollTop = lastCanvasScrollTopRef.current;
    const movedUp = currentScrollTop < previousScrollTop - 6;
    const movedDown = currentScrollTop > previousScrollTop + 6;
    const isProgrammaticScroll = Date.now() < programmaticScrollUntilRef.current;

    lastCanvasScrollTopRef.current = currentScrollTop;

    if (movedUp) {
      setAutoScrollLocked(false);
      revealCanvasControls();
    } else if (movedDown && !isProgrammaticScroll) {
      hideCanvasControls();
    }

    updateCanvasScrollState();
  };

  const openCanvas = () => {
    onCanvasOpen?.();
    setCanvasOpen(true);
    revealCanvasControls();
  };

  const closeCanvas = () => {
    setCanvasOpen(false);
    setAutoScrollLocked(false);
    setShowResumeAutoScroll(false);
    hideCanvasControls();
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

  const requestAgentAnswer = (
    sessionId: string,
    messageId: string,
    prompt: string,
    nextModel: AgentModelId,
    messageAttachments: AgentAttachment[],
    nextWebSearchEnabled: boolean,
    requestContext: AgentRuntimeContext
  ) => {
    setSendingMessageId(messageId);
    let streamedAnswer = '';
    let unsubscribe = () => {};

    const finishRequest = () => {
      unsubscribe();
      setSendingMessageId((current) => (current === messageId ? null : current));
      scheduleScrollToLatest();
    };

    try {
      const payload = {
        attachments: messageAttachments.map((attachment) => ({
          mimeType: attachment.mimeType,
          name: attachment.name,
          status: attachment.status
        })),
        context: requestContext,
        message: prompt,
        model: nextModel,
        sessionId,
        webSearch: nextWebSearchEnabled
      };
      const streamMessage = window.veloca?.agent.streamMessage;

      if (!streamMessage) {
        throw new Error('Veloca Agent is not available in this runtime.');
      }

      unsubscribe = streamMessage(payload, (event) => {
        if (event.type === 'delta') {
          streamedAnswer += event.content;
          updateSession(sessionId, (session) => ({
            ...session,
            messages: session.messages.map((message) =>
              message.id === messageId
                ? {
                    ...message,
                    answer: streamedAnswer,
                    responseParts: appendAgentTextPart(message.responseParts, event.content),
                    status: 'pending'
                  }
                : message
            )
          }));
          followStreamToBottom();
          return;
        }

        if (event.type === 'tool_calls') {
          return;
        }

        if (event.type === 'thinking') {
          updateSession(sessionId, (session) => ({
            ...session,
            messages: session.messages.map((message) =>
              message.id === messageId
                ? {
                    ...message,
                    responseParts: upsertAgentItemPart(message.responseParts, 'thinking', event.thinking)
                  }
                : message
            )
          }));
          followStreamToBottom();
          return;
        }

        if (event.type === 'tool_call') {
          updateSession(sessionId, (session) => ({
            ...session,
            messages: session.messages.map((message) =>
              message.id === messageId
                ? {
                    ...message,
                    responseParts: upsertAgentItemPart(message.responseParts, 'tool', event.toolCall),
                    toolCalls: upsertAgentToolCall(message.toolCalls, event.toolCall)
                  }
                : message
            )
          }));
          followStreamToBottom();
          return;
        }

        if (event.type === 'complete') {
          const answer = event.answer || streamedAnswer || 'Veloca returned an empty response.';

          updateSession(sessionId, (session) => ({
            ...session,
            messages: session.messages.map((message) =>
              message.id === messageId
                ? {
                    ...message,
                    answer,
                    status: 'complete'
                  }
                : message
            )
          }));
          finishRequest();
          return;
        }

        if (event.type === 'error') {
          updateSession(sessionId, (session) => ({
            ...session,
            messages: session.messages.map((message) =>
              message.id === messageId
                ? {
                    ...message,
                    answer: event.error,
                    status: 'error'
                  }
                : message
            )
          }));
          onToast?.({
            type: 'info',
            title: 'Agent request failed',
            description: event.error
          });
          finishRequest();
        }
      });
    } catch (error) {
      const description = error instanceof Error ? error.message : 'Agent request failed.';

      updateSession(sessionId, (session) => ({
        ...session,
        messages: session.messages.map((message) =>
          message.id === messageId
            ? {
                ...message,
                answer: description,
                status: 'error'
              }
            : message
        )
      }));
      onToast?.({
        type: 'info',
        title: 'Agent request failed',
        description
      });
      finishRequest();
    }
  };

  const sendMessage = () => {
    const prompt = input.trim();

    if (!prompt) {
      toggleFullVoiceMode();
      return;
    }

    if (sendingMessageId) {
      return;
    }

    const messageAttachments = attachments.map((attachment) => ({
      ...attachment,
      status: attachment.status === 'ready' ? attachment.status : ('recording' as const)
    }));
    const messageId = createAgentId('message');
    const sessionId = activeSessionId;
    const nextMessage: AgentConversation = {
      answer: '',
      attachments: messageAttachments,
      id: messageId,
      model,
      prompt,
      status: 'pending',
      webSearch: webSearchEnabled
    };

    updateSession(sessionId, (session) => ({
      ...session,
      messages: [...session.messages, nextMessage]
    }));
    setInput('');
    setAttachments([]);
    openCanvas();
    setEditing(null);
    scheduleScrollToLatest(true);
    void requestAgentAnswer(sessionId, messageId, prompt, model, messageAttachments, webSearchEnabled, context);
  };

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    sendMessage();
  };

  const createSession = () => {
    const createStoredSession = window.veloca?.agent.createSession;

    if (!createStoredSession) {
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
      return;
    }

    void createStoredSession(context)
      .then((storedSession) => {
        const nextSession = normalizeStoredSession(storedSession as StoredAgentSession);

        setSessions((current) => {
          if (current.some((session) => session.id === nextSession.id)) {
            return current.map((session) => (session.id === nextSession.id ? nextSession : session));
          }

          return [...current, nextSession];
        });
        setActiveSessionId(nextSession.id);
        closeCanvas();
        setEditing(null);
        setPopover(null);
      })
      .catch((error) => {
        onToast?.({
          type: 'info',
          title: 'Agent session unavailable',
          description: error instanceof Error ? error.message : 'Unable to create a local Agent session.'
        });
      });
  };

  const switchSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setEditing(null);
    setPopover(null);
    window.requestAnimationFrame(updateCanvasScrollState);
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

    if (!prompt || sendingMessageId) {
      return;
    }

    const sessionId = activeSessionId;
    const messageId = editing.messageId;
    const editingAttachments = editing.attachments;
    const message = activeMessages.find((item) => item.id === messageId);
    const nextModel = message?.model ?? model;
    const nextWebSearchEnabled = message?.webSearch ?? webSearchEnabled;

    updateSession(sessionId, (session) => ({
      ...session,
      messages: session.messages.map((currentMessage) =>
        currentMessage.id === messageId
          ? {
              ...currentMessage,
              answer: '',
              attachments: editingAttachments,
              prompt,
              status: 'pending'
            }
          : currentMessage
      )
    }));
    setEditing(null);
    openCanvas();
    scheduleScrollToLatest(true);
    void requestAgentAnswer(
      sessionId,
      messageId,
      prompt,
      nextModel,
      editingAttachments,
      nextWebSearchEnabled,
      context
    );
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

  const copyTextToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  };

  const copyMessage = async (message: AgentConversation) => {
    await copyTextToClipboard(message.prompt);
    setCopiedMessageId(message.id);
    onToast?.({
      type: 'success',
      title: 'Copied',
      description: 'The user message has been copied.'
    });

    const timer = window.setTimeout(() => setCopiedMessageId(null), 1200);
    pushTimer(timer);
  };

  const copyAnswer = async (message: AgentConversation) => {
    if (!message.answer.trim()) {
      return;
    }

    await copyTextToClipboard(message.answer);
    setCopiedAnswerId(message.id);
    onToast?.({
      type: 'success',
      title: 'Copied',
      description: 'The AI response has been copied.'
    });

    const timer = window.setTimeout(() => setCopiedAnswerId(null), 1200);
    pushTimer(timer);
  };

  const insertAnswer = (message: AgentConversation) => {
    console.info('[Veloca AI Insert] action triggered', {
      answerLength: message.answer.length,
      hasInsertHandler: Boolean(onInsertAnswer),
      messageId: message.id,
      targetFilePath: context.currentFilePath,
      visible,
      workspaceType: context.workspaceType
    });
    onInsertAnswer?.(message.answer, message.id, context.currentFilePath);
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
        autoScrollLocked ? 'is-auto-scrolling' : '',
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
              disabled={Boolean(input.trim() && sendingMessageId)}
              onClick={sendMessage}
            >
              {input.trim() ? <ArrowUp size={18} /> : voiceMode === 'idle' ? <AudioLines size={18} /> : <Square size={16} />}
            </button>
          </div>
        </div>

        <input className="agent-file-input" multiple onChange={handleFileInputChange} ref={fileInputRef} type="file" />
      </section>

      <div className={`agent-canvas${canvasOpen ? ' open' : ''}`} ref={canvasRef} onScroll={handleCanvasScroll}>
        <div className={`agent-canvas-control${canvasControlsVisible || popover === 'session' ? ' show' : ''}`}>
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
                        <button
                          className="confirm"
                          type="button"
                          title="Confirm"
                          disabled={Boolean(sendingMessageId)}
                          onClick={confirmEditMessage}
                        >
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

              <div className={`agent-ai-msg ${message.status}`}>
                <div className="agent-ai-content">
                  <AgentResponseTimeline message={message} />
                </div>

                {message.status === 'complete' && message.answer.trim() && (
                  <div className="agent-ai-actions">
                    <button
                      className={copiedAnswerId === message.id ? 'copied' : ''}
                      type="button"
                      title="Copy"
                      aria-label="Copy AI response"
                      onClick={() => void copyAnswer(message)}
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      type="button"
                      title="Insert"
                      aria-label="Insert AI response"
                      onPointerDown={(event) => {
                        if (event.button !== 0) {
                          return;
                        }

                        event.preventDefault();
                        event.stopPropagation();
                        pointerInsertHandledRef.current = message.id;
                        insertAnswer(message);
                        window.setTimeout(() => {
                          if (pointerInsertHandledRef.current === message.id) {
                            pointerInsertHandledRef.current = null;
                          }
                        }, 0);
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (pointerInsertHandledRef.current === message.id) {
                          return;
                        }

                        insertAnswer(message);
                      }}
                    >
                      <FileInput size={14} />
                    </button>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <div className={`agent-canvas-floating-actions${canvasOpen ? ' show' : ''}`}>
        <button
          className={`agent-floating-action agent-back-latest-btn${showScrollLatest ? ' show' : ''}`}
          type="button"
          onClick={scrollToLatest}
        >
          <ArrowDown size={14} />
          <span>Back to latest</span>
        </button>
        <button
          className={`agent-floating-action agent-resume-autoscroll-btn${!showScrollLatest && showResumeAutoScroll ? ' show' : ''}`}
          type="button"
          aria-label="Resume auto-scroll"
          title="Resume auto-scroll"
          onClick={resumeAutoScroll}
        >
          <ArrowDown size={16} />
        </button>
      </div>
    </div>
  );
}
