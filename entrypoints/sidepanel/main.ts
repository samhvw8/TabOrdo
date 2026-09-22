import { mount } from "svelte";
import App from "../popup/App.svelte";
import "../../app.css";

mount(App, { target: document.getElementById("app")!, props: { fluid: true } });
