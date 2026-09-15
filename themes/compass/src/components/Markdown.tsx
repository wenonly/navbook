// assistant 消息 Markdown 渲染(react-markdown 默认不渲染原始 HTML,无 XSS 面)。
// 独立模块 + AssistantBubble 内 React.lazy:库较重(~150KB),公开主题页不随首屏下发,
// 管理员打开 AI 面板才按需加载。
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function Markdown({ text }: { text: string }) {
  return (
    <div className="leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => <a href={props.href} target="_blank" rel="noreferrer"
            className="text-accent underline underline-offset-2">{props.children}</a>,
          p: ({ children }) => <p className="mb-2">{children}</p>,
          ul: ({ children }) => <ul className="mb-2 list-disc pl-5 [&_li]:mt-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-decimal pl-5 [&_li]:mt-0.5">{children}</ol>,
          h1: ({ children }) => <h1 className="mb-2 text-base font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 text-sm font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 text-sm font-semibold">{children}</h3>,
          blockquote: ({ children }) => <blockquote className="mb-2 border-l-2 border-border pl-3 text-faint">{children}</blockquote>,
          table: ({ children }) => <table className="mb-2 w-full border-collapse text-xs [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1">{children}</table>,
          pre: ({ children }) => <pre className="mb-2 max-w-full overflow-x-auto rounded-input bg-card p-2.5 text-xs [&_code]:bg-transparent [&_code]:p-0">{children}</pre>,
          code: ({ children }) => <code className="rounded bg-card px-1 py-0.5 font-mono">{children}</code>,
          hr: () => <hr className="my-2 border-border" />,
        }}
      >{text}</ReactMarkdown>
    </div>
  );
}
