import EditorAbout from './pages/EditorAbout'
import ImageEditor from './pages/ImageEditor'
import VideoEditor from './pages/VideoEditor'

declare global {
  interface Window { aieditPage: string }
}

const PAGES: Record<string, React.ReactNode> = {
  about: <EditorAbout />,
  edit:  <ImageEditor />,
  video: <VideoEditor />,
}

export default function App() {
  const page = window.aieditPage
  return <>{PAGES[page]}</>
}
