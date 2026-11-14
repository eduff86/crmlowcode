import {defineConfig} from 'vite';
export default defineConfig({
 base:process.env.DEMO_BROWSER==='1'?'/crmlowcode/':'/',
 define:{'import.meta.env.BROWSER_DEMO':JSON.stringify(process.env.DEMO_BROWSER==='1')},
 worker:{format:'es'},
 build:{outDir:process.env.DEMO_BROWSER==='1'?'dist-pages':'dist'}
});
