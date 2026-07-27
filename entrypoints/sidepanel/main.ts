import { mount } from "svelte";
import App from "../popup/App.svelte";
import "../../app.css";

document.documentElement.style.width = "100%";
document.documentElement.style.height = "100%";

mount(App, { target: document.getElementById("app")!, props: { fluid: true } });
