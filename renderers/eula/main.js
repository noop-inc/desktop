import './reboot.css'
import './style.css'
import { marked } from 'marked'
import licence from '../../LICENSE.md?raw'

// Override function
const renderer = {
  link: (href, title, text) =>
    `<a${href ? ` href="${href}"` : ''}${title ? ` title="${title}"` : ''}${href?.startsWith('http') ? ' target="_blank"' : ''}>${text || ''}</a>`
}

marked.use({ renderer })

const html = marked.parse(licence)

document.querySelector('#app').innerHTML = `
  <div class="content">
    <h1 class="header">
      <span>End-User License Agreement</span>
    </h1>
    <section class="eula" id="eula">${html}</section>
    <section class="buttons">
      <button id="accept" type="button">Accept</button>
      <button id="decline" type="button">Decline</button>
    </section>
  </div>
`

const setupAccept = element => {
  const setAccept = async () => await window.electron.eula(true)
  element.addEventListener('click', () => setAccept())
}

const setupDecline = element => {
  const setDecline = async () => await window.electron.eula(false)
  element.addEventListener('click', () => setDecline())
}

setupAccept(document.getElementById('accept'))
setupDecline(document.getElementById('decline'))

// const setupScroll = element => {
//   const setScroll = () => {
//     if (element.scrollHeight - element.scrollTop - element.clientHeight < 1) {
//       document.getElementById('accept').disabled = false
//       document.getElementById('decline').disabled = false
//     }
//   }

//   element.addEventListener('scroll', setScroll)
// }

// setupScroll(document.getElementById('eula'))
