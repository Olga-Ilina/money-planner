import { render } from 'preact';
import { App } from './ui/App';
import { registerPwa } from './ui/registerPwa';
import './ui/styles.css';

const root = document.getElementById('app');
if (!root) throw new Error('Root element #app not found');
render(<App />, root);
registerPwa();
