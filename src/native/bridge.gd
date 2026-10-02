extends Node

var peer = StreamPeerTCP.new()
var input_buffer = PackedByteArray()
var targets = {}
var scripted = {}
var labels = []
var revision = 0
var last_state = ""
var elapsed = 0.0
var greeted = false
var token = ""
var load_number = 0
var shells = {}
var health = {"player": null, "dealer": null}
var observations = []
var observation_number = 0
var latest_snapshot = {}
var held_actions = {}
var held_keys = {}
var controls = []
var scene_id = 0
var seat_health = {}

func _init():
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--cortico-executable="):
			if !ProjectSettings.load_resource_pack(arg.trim_prefix("--cortico-executable="), false):
				push_error("Cortico could not load the original game resource pack")

func _ready():
	process_mode = Node.PROCESS_MODE_ALWAYS
	var port = 0
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--cortico-port="): port = int(arg.trim_prefix("--cortico-port="))
		if arg.begins_with("--cortico-token="): token = arg.trim_prefix("--cortico-token=")
	if port == 0 or token == "":
		set_process(false)
		return
	get_tree().node_added.connect(RegisterNode)
	RegisterTree(get_tree().root)
	peer.connect_to_host("127.0.0.1", port)

func RegisterTree(node):
	RegisterNode(node)
	for child in node.get_children(): RegisterTree(child)

func RegisterNode(node):
	if node == self: return
	if node is Label or node is Label3D: labels.append(node)
	if node is BaseButton or node is Slider or node is LineEdit or node is TextEdit: controls.append(node)
	var script = node.get_script()
	if script == null: return
	var file = script.resource_path.get_file()
	if !scripted.has(file): scripted[file] = []
	scripted[file].append(node)

func Nodes(file):
	var valid = []
	for node in scripted.get(file, []):
		if is_instance_valid(node) and node.is_inside_tree(): valid.append(node)
	scripted[file] = valid
	return valid

func First(file):
	var found = Nodes(file)
	return found[0] if found.size() > 0 else null

func _process(delta):
	peer.poll()
	if peer.get_status() != StreamPeerTCP.STATUS_CONNECTED: return
	if !greeted:
		Send({"kind": "hello", "protocol": 1, "token": token, "pid": OS.get_process_id(), "version": get_node("/root/GlobalVariables").version_to_check})
		greeted = true
	var available = peer.get_available_bytes()
	if available > 0:
		var result = peer.get_data(available)
		if result[0] == OK: input_buffer.append_array(result[1])
	var newline = input_buffer.find(10)
	while newline != -1:
		var line = input_buffer.slice(0, newline).get_string_from_utf8()
		input_buffer = input_buffer.slice(newline + 1)
		var request = JSON.parse_string(line)
		if request is Dictionary: Handle(request)
		newline = input_buffer.find(10)
	elapsed += delta
	if elapsed >= 0.1:
		elapsed = 0
		Publish()
	for action in held_actions.keys():
		if Time.get_ticks_msec() >= held_actions[action]:
			ReleaseAction(action)
	for key in held_keys.keys():
		if Time.get_ticks_msec() >= held_keys[key]:
			KeyEvent(key, false)
			held_keys.erase(key)

func Send(message):
	if peer.get_status() == StreamPeerTCP.STATUS_CONNECTED:
		peer.put_data((JSON.stringify(message) + "\n").to_utf8_buffer())

func Record(event_kind, facts):
	observation_number += 1
	var event = {"number": observation_number, "kind": event_kind, "facts": facts}
	observations.append(event)
	Send({"kind": "observation", "event": event})

func ObserveLoad(live, blank):
	load_number += 1
	shells = {"load": load_number, "initialLive": live, "initialBlank": blank, "consumed": 0, "known": {}, "inversions": []}
	Record("load", {"load": load_number, "live": live, "blank": blank})

func ObserveReveal(index, shell, reason):
	if shells.is_empty(): return
	var absolute = shells.consumed + index
	shells.known[str(absolute)] = shell
	Record("reveal", {"load": load_number, "position": index + 1, "ordinal": absolute + 1, "shell": shell, "reason": reason})

func ObserveEjection(shell, dealer):
	if shells.is_empty(): return
	Record("ejection", {"load": load_number, "ordinal": shells.consumed + 1, "shell": shell, "actor": ("dealer" if dealer else "player") if dealer is bool else dealer})
	shells.known.erase(str(shells.consumed))
	shells.consumed += 1

func ObserveInverter():
	if shells.is_empty(): return
	var key = str(shells.consumed)
	if shells.known.has(key): shells.known[key] = "blank" if shells.known[key] == "live" else "live"
	shells.inversions.append(shells.consumed + 1)
	Record("inversion", {"load": load_number, "ordinal": shells.consumed + 1})

func ObserveHealth(player, dealer):
	health = {"player": player, "dealer": dealer}
	Record("health", health)

func ObserveSeatHealth(seat, value):
	seat_health[str(seat)] = value
	Record("health", {"seat": seat, "value": value})

func ObserveLocalReveal(shell, mesh):
	var current_load = load_number
	var current_consumed = shells.get("consumed", -1)
	while is_instance_valid(mesh) and mesh.is_inside_tree():
		await get_tree().process_frame
		if current_load != load_number or current_consumed != shells.get("consumed", -1): return
		if Visible(mesh):
			ObserveReveal(0, shell, "magnifying glass")
			return

func Visible(node):
	if !is_instance_valid(node) or !node.is_inside_tree(): return false
	if node is CanvasItem:
		if !node.is_visible_in_tree(): return false
		var parent = node
		while parent is CanvasItem:
			if parent.modulate.a == 0: return false
			parent = parent.get_parent()
		return true
	if node is Node3D: return node.is_visible_in_tree()
	return true

func ColliderAvailable(parent):
	for child in parent.get_children():
		if child is CollisionObject3D and child.collision_layer != 0:
			for shape in child.get_children():
				if shape is CollisionShape3D and !shape.disabled: return true
	return false

func AddTarget(node, label, target_kind, extra = {}):
	var id = "t" + str(node.get_instance_id())
	targets[id] = {"node": node, "kind": target_kind}
	var target = {"id": id, "label": label, "kind": target_kind}
	target.merge(extra)
	return target

func ButtonLabel(button, controller):
	var alias = controller.get("alias")
	if alias is String and alias != "": return alias
	if button is Button and button.text != "": return button.text
	for child in button.get_children():
		if child is Label and child.text != "": return child.text
	return button.name

func Snapshot():
	targets.clear()
	var scene = get_tree().current_scene
	var next_scene_id = scene.get_instance_id() if scene != null else 0
	if next_scene_id != scene_id:
		scene_id = next_scene_id
		shells = {}
		health = {"player": null, "dealer": null}
		seat_health = {}
	var scene_name = scene.scene_file_path.get_file().get_basename() if scene != null else "loading"
	var actions = []
	var inventory = []
	var main_cursor = First("CursorManager.gd")
	var inter = First("InteractionManager.gd")
	var menu = First("MenuManager.gd")
	var local_player = null
	var handled_buttons = {}
	for player in Nodes("MP_UserInstanceProperties.gd"):
		if player.is_active: local_player = player
	for file in ["ButtonClass.gd", "ButtonClass_Main.gd", "MP_ButtonClassMain.gd"]:
		for controller in Nodes(file):
			var button = controller.get_parent()
			if !(button is BaseButton) or !button.is_visible_in_tree() or button.disabled or button.mouse_filter == Control.MOUSE_FILTER_IGNORE: continue
			if file == "MP_ButtonClassMain.gd":
				if !controller.is_active or controller.is_emulating_mouse_in_main: continue
				if !controller.is_lobby_scene and local_player == null: continue
				if controller.ui != null and !Visible(controller.ui): continue
				if controller.ui_3D != null and !Visible(controller.ui_3D): continue
			else:
				if !controller.isActive or !controller.mainActive: continue
				if file == "ButtonClass.gd" and !Visible(controller.ui): continue
				if file == "ButtonClass_Main.gd" and !Visible(controller.ui_3D if controller.is3D else controller.ui): continue
				if file == "ButtonClass_Main.gd" and (controller.overridingMouseRaycast or controller.usingInteractionBranch): continue
			if main_cursor != null and !main_cursor.cursor_visible: continue
			var label = ButtonLabel(button, controller)
			var sub_alias = controller.get("sub_alias")
			if sub_alias is String and sub_alias != "": label += " " + sub_alias
			actions.append(AddTarget(controller, label, "button"))
			handled_buttons[button.get_instance_id()] = true
			if file == "MP_ButtonClassMain.gd":
				if controller.right_click_enabled: actions.append(AddTargetOperation(controller, label + " (right click)", "right click"))
				if controller.mouse_wheel_enabled:
					actions.append(AddTargetOperation(controller, label + " (wheel up)", "wheel up"))
					actions.append(AddTargetOperation(controller, label + " (wheel down)", "wheel down"))
	var valid_controls = []
	for control in controls:
		if !is_instance_valid(control): continue
		valid_controls.append(control)
		if !Visible(control) or control.mouse_filter == Control.MOUSE_FILTER_IGNORE: continue
		if control is BaseButton:
			if handled_buttons.has(control.get_instance_id()) or control.disabled: continue
			# Transparent hitboxes are described by their scripted controller.
			if control.modulate.a == 0 or control.self_modulate.a == 0: continue
			actions.append(AddTarget(control, control.text if control is Button and control.text != "" else control.name, "control"))
		elif control is Slider:
			if control.editable: actions.append(AddTarget(control, control.name, "slider", {"value": control.value, "minimum": control.min_value, "maximum": control.max_value, "step": control.step}))
		elif control.editable: actions.append(AddTarget(control, control.name, "text field"))
	controls = valid_controls
	if main_cursor != null and inter != null:
		var item_manager = First("ItemManager.gd")
		for branch in Nodes("InteractionBranch.gd"):
			if !Visible(branch.get_parent()): continue
			if branch.interactionAlias == "item" and branch.itemName != "":
				if item_manager != null and item_manager.activeItem == branch.get_parent() and !branch.isPlayerSide:
					inventory.append({"item": branch.itemName, "side": "held", "slot": 0})
				else: inventory.append({"item": branch.itemName, "side": "player" if branch.isPlayerSide else "dealer", "slot": branch.itemGridIndex + 1})
			if !main_cursor.cursor_visible or !branch.interactionAllowed or branch.interactionInvalid or !ColliderAvailable(branch.get_parent()): continue
			var label = branch.interactionAlias
			var extra = {}
			if branch.isGrid:
				label = "place item in slot " + str(branch.gridIndex + 1)
				extra["slot"] = branch.gridIndex + 1
			if label == "item":
				label = branch.itemName
				extra = {"side": "player" if branch.isPlayerSide else "dealer", "slot": branch.itemGridIndex + 1}
			if label == "signature machine button": label = "signature " + (branch.signatureButton_letterAlias if branch.signatureButton_letterAlias != "" else branch.signatureButton_specialAlias)
			if label == "crt button": label = "crt " + branch.crtButton_alias
			actions.append(AddTarget(branch, label, "interaction", extra))
	if local_player != null:
		for branch in Nodes("MP_InteractionBranch.gd"):
			if !Visible(branch.get_parent()): continue
			if branch.itemName != "": inventory.append({"item": branch.itemName, "side": str(branch.socket_number), "slot": branch.local_grid_index + 1})
			if !local_player.major_permission_enabled or local_player.camera_look.looking_active: continue
			if !local_player.cursor.cursor_visible or !branch.interactionAllowed or branch.interactionInvalid or branch.interactionInspecting or !ColliderAvailable(branch.get_parent()): continue
			var label = branch.itemName if branch.itemName != "" else branch.interactionAlias
			if branch.interactionAlias == "hover pan object": label = "shoot seat " + str(branch.socket_number)
			if branch.interactionAlias == "item grid": label = "place item in slot " + str(branch.grid_index + 1)
			if branch.interactionAlias == "jammer button": label = "jam seat " + str(branch.socket_number)
			actions.append(AddTarget(branch, label, "multiplayer interaction", {"side": str(branch.socket_number), "slot": branch.local_grid_index + 1}))
	if menu != null and menu.viewing_intro: actions.append(AddTarget(menu, "skip intro", "skip intro"))
	var ending = First("EndingManager.gd")
	if ending != null and ending.waitingForInput: actions.append(AddTarget(ending, "continue after ending", "continue"))
	var exit_manager = First("UserExit.gd")
	if exit_manager != null and exit_manager.exitAllowed: actions.append(AddTarget(exit_manager, "hold to return to menu", "exit"))
	var texts = []
	var valid_labels = []
	for label in labels:
		if !is_instance_valid(label): continue
		valid_labels.append(label)
		if !Visible(label) or label.text == "": continue
		if label is Label3D:
			var camera = get_viewport().get_camera_3d()
			if camera == null or camera.is_position_behind(label.global_position): continue
			if !get_viewport().get_visible_rect().has_point(camera.unproject_position(label.global_position)): continue
		var text = label.text
		if label.visible_characters >= 0: text = text.left(label.visible_characters)
		if text != "" and !texts.has(text): texts.append(text)
	labels = valid_labels
	var status = {"scene": scene_name, "actions": actions, "inventory": inventory, "texts": texts, "shells": shells.duplicate(true), "health": health.duplicate(), "observationNumber": observation_number}
	if menu != null: status["menu"] = menu.currentScreen
	var round_manager = First("RoundManager.gd")
	if round_manager != null and round_manager.playerData.hasSignedWaiver:
		status["round"] = round_manager.playerData.currentBatchIndex + 1
		status["mode"] = "double or nothing" if round_manager.endless else "story"
		status["dealerCuffed"] = round_manager.dealerCuffed
		status["playerCuffed"] = round_manager.playerCuffed
		status["barrelSawedOff"] = round_manager.barrelSawedOff
		if round_manager.intbranch_yes.interactionAllowed: status["cash"] = round_manager.endscore
	var cutter = First("DefibCutter.gd")
	if cutter != null:
		if cutter.displayBroken_player: status.health.player = null
		if cutter.displayBroken_dealer: status.health.dealer = null
	if ending != null and Visible(ending.uiparent) and Visible(ending.label_congrats): status["outcome"] = "won"; status["cash"] = ending.cash_gl
	if local_player != null:
		status["localSeat"] = local_player.socket_number
		status["mode"] = "multiplayer"
		status["players"] = []
		for player in Nodes("MP_UserInstanceProperties.gd"):
			status.players.append({"seat": player.socket_number, "name": player.user_name, "health": seat_health.get(str(player.socket_number))})
		status["freeLook"] = local_player.camera_look.looking_active
	status["viewport"] = {"width": get_viewport().get_visible_rect().size.x, "height": get_viewport().get_visible_rect().size.y}
	status["inputActions"] = ["ui_accept", "ui_cancel", "ui_focus_next", "ui_focus_prev", "ui_left", "ui_right", "ui_up", "ui_down", "reset", "exit game", "free look toggle", "right_click2", "scroll_up", "scroll_down"]
	return status

func AddTargetOperation(node, label, operation):
	var id = "t" + str(node.get_instance_id()) + ":" + operation
	targets[id] = {"node": node, "kind": operation}
	return {"id": id, "label": label, "kind": operation}

func Publish(force = false):
	var snapshot = Snapshot()
	var serialized = JSON.stringify(snapshot)
	if serialized != last_state:
		revision += 1
		last_state = serialized
		snapshot["revision"] = revision
		latest_snapshot = snapshot
		Send({"kind": "snapshot", "snapshot": snapshot})
	elif force:
		snapshot["revision"] = revision
		latest_snapshot = snapshot
		Send({"kind": "snapshot", "snapshot": snapshot})

func Reply(id, success, detail, extra = {}):
	var reply = {"kind": "reply", "id": id, "ok": success, "detail": detail}
	reply.merge(extra)
	Send(reply)

func Handle(request):
	var id = request.get("id", "")
	match request.get("action", ""):
		"snapshot":
			Publish(true)
			Reply(id, true, "observed", {"snapshot": latest_snapshot, "observations": observations})
		"act":
			Publish()
			var expected = request.get("revision", revision)
			if expected != revision:
				Reply(id, false, "state changed; observe again", {"snapshot": latest_snapshot})
				return
			var target = targets.get(request.get("target", ""))
			if target == null:
				Reply(id, false, "target is unavailable", {"snapshot": latest_snapshot})
				return
			var node = target.node
			match target.kind:
				"button": node.get_parent().emit_signal("pressed")
				"right click": node.OnRightClick()
				"wheel up": node.OnMouseWheelUp()
				"wheel down": node.OnMouseWheelDown()
				"control": node.emit_signal("pressed")
				"text field": node.grab_focus()
				"slider":
					if !request.get("value") is float and !request.get("value") is int:
						Reply(id, false, "slider requires a value")
						return
					node.value = clampf(request.value, node.min_value, node.max_value)
				"interaction":
					var inter = First("InteractionManager.gd")
					inter.activeInteractionBranch = node
					inter.MainInteractionEvent()
				"multiplayer interaction":
					for player in Nodes("MP_UserInstanceProperties.gd"):
						if player.is_active:
							player.interaction.activeInteractionBranch = node
							player.interaction.MainInteractionEvent()
				"skip intro": node.SkipIntro()
				"continue":
					var event = InputEventKey.new()
					event.keycode = KEY_ENTER
					event.pressed = true
					Input.parse_input_event(event)
					event = InputEventKey.new()
					event.keycode = KEY_ENTER
					Input.parse_input_event(event)
				"exit": HoldAction("exit game", 2200)
			Publish(true)
			Reply(id, true, "input delivered", {"snapshot": latest_snapshot})
		"input":
			var action = request.get("name", "")
			if !InputMap.has_action(action) or !latest_snapshot.inputActions.has(action):
				Reply(id, false, "unknown input action")
				return
			HoldAction(action, int(request.get("durationMs", 100)))
			Reply(id, true, "input delivered")
		"text":
			var control = get_viewport().gui_get_focus_owner()
			if !(control is LineEdit) and !(control is TextEdit):
				Reply(id, false, "no text field focused")
				return
			control.text = str(request.get("text", ""))
			control.emit_signal("text_changed", control.text) if control is LineEdit else control.emit_signal("text_changed")
			Reply(id, true, "text entered")
		"key":
			var key = OS.find_keycode_from_string(str(request.get("key", "")))
			if key == 0:
				Reply(id, false, "unknown key")
				return
			KeyEvent(key, true)
			held_keys[key] = Time.get_ticks_msec() + int(request.get("durationMs", 100))
			Reply(id, true, "input delivered")
		"pointer":
			var event = InputEventMouseMotion.new()
			event.position = Vector2(request.get("x", 0), request.get("y", 0))
			event.global_position = event.position
			event.relative = Vector2(request.get("relativeX", 0), request.get("relativeY", 0))
			Input.parse_input_event(event)
			var buttons = {"left": MOUSE_BUTTON_LEFT, "right": MOUSE_BUTTON_RIGHT, "middle": MOUSE_BUTTON_MIDDLE, "wheel up": MOUSE_BUTTON_WHEEL_UP, "wheel down": MOUSE_BUTTON_WHEEL_DOWN}
			var button = buttons.get(request.get("button", "move"), 0)
			if button != 0:
				MouseEvent(event.position, button, true)
				MouseEvent(event.position, button, false)
			Reply(id, true, "input delivered")
		"controller":
			if request.has("axis"):
				var event = InputEventJoypadMotion.new()
				event.axis = int(request.axis)
				event.axis_value = float(request.get("value", 0))
				Input.parse_input_event(event)
			else:
				var event = InputEventJoypadButton.new()
				event.button_index = int(request.get("button", 0))
				event.pressed = bool(request.get("pressed", true))
				Input.parse_input_event(event)
			Reply(id, true, "input delivered")
		"capture": Capture(id)
		"quit":
			for action in held_actions.keys(): ReleaseAction(action)
			for key in held_keys.keys(): KeyEvent(key, false)
			Reply(id, true, "closing owned game")
			get_tree().quit()
		_: Reply(id, false, "unknown bridge action")

func HoldAction(action, duration):
	var event = InputEventAction.new()
	event.action = action
	event.pressed = true
	Input.parse_input_event(event)
	held_actions[action] = Time.get_ticks_msec() + duration

func KeyEvent(key, pressed):
	var event = InputEventKey.new()
	event.keycode = key
	event.physical_keycode = key
	event.pressed = pressed
	Input.parse_input_event(event)

func MouseEvent(position, button, pressed):
	var event = InputEventMouseButton.new()
	event.position = position
	event.global_position = position
	event.button_index = button
	event.pressed = pressed
	Input.parse_input_event(event)

func ReleaseAction(action):
	var event = InputEventAction.new()
	event.action = action
	Input.parse_input_event(event)
	held_actions.erase(action)

func Capture(id):
	if DisplayServer.get_name() == "headless":
		Reply(id, false, "capture requires a rendered game window")
		return
	await RenderingServer.frame_post_draw
	var image = get_viewport().get_texture().get_image()
	Reply(id, true, "captured", {"png": Marshalls.raw_to_base64(image.save_png_to_buffer())})
