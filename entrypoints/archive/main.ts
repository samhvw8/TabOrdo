import { mount } from "svelte";
import App from "./App.svelte";
import "../../app.css";

document.documentElement.style.cssText = "width:100%;height:100%";
document.body.style.cssText = "width:100%;height:100%;overflow:auto";
document.getElementById("app")!.style.cssText = "height:auto;overflow:visible";

mount(App, { target: document.getElementById("app")! });
