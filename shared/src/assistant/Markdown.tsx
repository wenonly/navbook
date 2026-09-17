// assistant 内部 Markdown 渲染(lazy 分包;react-markdown 默认不渲染原始 HTML,无 XSS 面)
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function Markdown({ text }: { text: string }) {
  return (
    <div className="nba-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
