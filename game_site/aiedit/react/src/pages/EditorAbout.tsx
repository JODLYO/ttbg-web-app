import { HOME_IMG_BASE } from '../constants'

const EXAMPLES = [
  { label: 'Uploaded Image',              file: 'football_sunset.jpeg',          alt: 'Football Sunset'  },
  { label: 'Selected Style 1',            file: 'the_scream.jpeg',               alt: 'The Scream'       },
  { label: 'Selected Style 2',            file: 'mosaic_ducks_massimo.jpeg',     alt: 'Mosaic Ducks'     },
  { label: 'Uploaded Image Edited',       file: 'edited_sunset.jpeg',            alt: 'Edited Sunset'    },
  { label: 'Image with Style 1',          file: 'football_sunset_scream.jpeg',   alt: 'Football Scream'  },
  { label: 'Image with Style 2',          file: 'football_sunset_duck.jpeg',     alt: 'Football Duck'    },
]

export default function EditorAbout() {
  return (
    <div className="header">
      <br />
      <h1>aiedit</h1>
      <p>
        Apply artistic styles to your images and videos — all processing runs in your browser.
      </p>
      <h3>Example output</h3>
      <div className="home-grid-container">
        {EXAMPLES.map(({ label, file, alt }) => (
          <div key={file} className="home-grid-item">
            <h3>{label}</h3>
            <img src={`${HOME_IMG_BASE}/${file}`} alt={alt} />
          </div>
        ))}
      </div>

      <div className="about-explainer">
        <p>
          The image style editor works by using a content image and a style image to create a new
          image of the content in the chosen style.
        </p>
        <br />
        <p>
          The below video by Andrew Ng explains this well as does the{' '}
          <a href="https://arxiv.org/abs/1508.06576">original paper</a>.
        </p>
        <br />
        <a
          href="https://www.youtube.com/watch?v=R39tWYYKNcI"
          target="_blank"
          rel="noopener noreferrer"
          className="about-youtube-link"
        >
          <img
            src="https://img.youtube.com/vi/R39tWYYKNcI/hqdefault.jpg"
            alt="Andrew Ng — Neural Style Transfer"
            className="about-youtube-thumb"
          />
          <span className="about-youtube-overlay">
            <svg width="68" height="48" viewBox="0 0 68 48">
              <rect width="68" height="48" rx="10" fill="rgba(0,0,0,.7)" />
              <polygon points="26,14 26,34 46,24" fill="white" />
            </svg>
          </span>
        </a>
        <br /><br />
        <p>
          One problem with the original paper is it takes a lot of processing power and time to
          generate the desired image. Thankfully this can be reduced by using a feed-forward network
          where most of the processing power and time is done during training the neural network.
        </p>
        <br />
        <p>
          The idea behind this was first done in{' '}
          <a href="https://arxiv.org/pdf/1703.06953.pdf">MSG-Net</a>. This web-app is based upon
          this technique and is implemented in TensorFlow instead of PyTorch.
        </p>
      </div>
    </div>
  )
}
