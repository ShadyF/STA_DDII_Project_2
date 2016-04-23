/// <reference path="jquery-2.2.2.min.js" />

var app;
$(function () {
    "use strict";

    app = new function () {
        var that = this;

        var g = new graphlib.Graph();
        var cell_count = 0;
        var input_nodes = [], output_nodes = [];
        var visited = {};
        var current_path = [];
        var all_paths = [];

        var loadingElements = {
            itemsCount: 0,
            elements: [{
                elName: "libraryInput",
                varName: "library",
                loaded: false,
                onLoaded: onLibraryLoaded
            }, {
                elName: "netListInput",
                varName: "netlist",
                loaded: false,
                onLoaded: onNetListLoaded
            }]
        }

        function readLocalJSON(el, fn) {
            var file = el.files[0];

            if (file) {
                var reader = new FileReader();

                reader.onload = function (e) {
                    fn.call($(el), JSON.parse(e.target.result));
                };
                reader.readAsText(file);
            }
        }

        for (var i = 0; i < loadingElements.elements.length; ++i) {
            var item = loadingElements.elements[i];
            (function (item) {
                $(document).on("change", "#" + item.elName, function (event) {
                    readLocalJSON(this, function (result) {
                        ++loadingElements.itemsCount;
                        item.loaded = true;
                        that[item.varName] = result;

                        this.prev("label").hide();
                        this.hide();
                        $("<label></label>")
                            .html(this.val() + " has been loaded!")
                            .insertBefore(this);

                        if (item.onLoaded)
                            item.onLoaded.call(this);

                        if (loadingElements.itemsCount === loadingElements.elements.length)
                            onAllJsonFilesLoaded();
                    });
                });
            })(item);
        }


        function onLibraryLoaded() {
            alert("when library is loaded");
        }

        function onNetListLoaded(result) {
            // if you need to do anything after the netlist has been loaded
            alert("when netlist is loaded");
        }

        function onAllJsonFilesLoaded() {
            var SCL = app["library"];
            var cells = SCL.cells;
            console.log(SCL);
            console.log(app["netlist"]);
            createNetlistDAG(app["netlist"], SCL);

            //initialise visited array to false
            for (var i = 0; i < g.nodes().length; i++)
                visited[g.nodes()[i]] = false;

            //loop over inputs and outputs timing paths, > O(n^2), didn't calculate identifyTimingPaths
            for (var i in input_nodes)
                for (var j in output_nodes) {
                    current_path = [];
                    all_paths = [];
                    identifyTimingPaths(input_nodes[i], output_nodes[j]);
                    for (var k = 0; k < all_paths.length; k++)
                        printPath(all_paths[k]);
                }
            alert("all loaded");
        }

        //only deals with flattened modules for now
        function createNetlistDAG(vnetlist, SCL) {
            var library_cells = SCL.cells;      //return library cells
            var netlist_cells = vnetlist.modules[Object.keys(vnetlist.modules)[0]].cells; //returns netlist cells
            var netlist_ports = vnetlist.modules[Object.keys(vnetlist.modules)[0]].ports; //return netlist ports

            var input_net_ids = {};
            var output_net_ids = {};

            for (var cell in netlist_cells) {
                var current_cell = netlist_cells[cell];
                var cell_type = current_cell.type;
                var library_cell = library_cells[cell_type];
                var cell_inputs = [];
                var cell_outputs = []

                //CHECK IF FLIP FLOP HERE
                for (var pin in current_cell.connections) {
                    var bit_id = current_cell.connections[pin][0];      //assumes gate deals with a max of 1 bit per pin
                    var pin_direction = library_cell.pins[pin].direction;
                    var pin_capacitance = library_cell.pins[pin].capacitance;
                    var node_name = "U" + cell_count + "/" + pin + "_" + bit_id;//+ "_" + pin_direction;

                    if (pin_direction === "input") {
                        if (cell_type.indexOf("DFF") > -1 && pin != "CLK" && pin != "R")        //change this to make use of is_ff in library cells
                            output_nodes.push(node_name)
                        cell_inputs.push(node_name);
                        if (bit_id in input_net_ids) input_net_ids[bit_id].push(node_name);
                        else input_net_ids[bit_id] = [node_name];
                    }
                    else {
                        if (cell_type.indexOf("DFF") > -1)                                      //change this to make use of is_ff in library cells
                            input_nodes.push(node_name)
                        cell_outputs.push(node_name);
                        if (bit_id in output_net_ids) output_net_ids[bit_id].push(node_name);
                        else output_net_ids[bit_id] = [node_name];
                    }

                    g.setNode(node_name, { type: cell_type, direction: pin_direction, capacitance: pin_capacitance});
                }

                //make connections between cell pins(inputs to outputs)
                //ADD CELL DELAY IN THIS LOOP
                for (var i = 0; i < cell_inputs.length; i++)
                    for (var j = 0; j < cell_outputs.length; j++)
                        g.setEdge(cell_inputs[i], cell_outputs[j]);

                cell_count++;
            }

            //making wire connections between gates
            //ADD WIRE DELAY HERE
            for (var output_id in output_net_ids)
                if (output_id in input_net_ids)
                    for (var i = 0; i < output_net_ids[output_id].length; i++)
                        for (var j = 0; j < input_net_ids[output_id].length; j++)
                            g.setEdge(output_net_ids[output_id][i], input_net_ids[output_id][j]);


            //add input and outputs nodes to graph
            for (var port_name in netlist_ports) {
                var port = netlist_ports[port_name];

                if (port.direction === "input") {
                    for (var i = 0; i < port.bits.length; i++) {
                        var node_name = port_name + "[" + i + "]";
                        g.setNode(node_name, { type: "input" });
                        input_nodes.push(node_name);
                        for (var j = 0; j < input_net_ids[port.bits[i]].length; j++)
                            g.setEdge(node_name, input_net_ids[port.bits[i]][j]);
                    }
                }

                else {
                    for (var i = 0; i < port.bits.length; i++) {
                        var node_name = port_name + "[" + i + "]";
                        g.setNode(node_name, { type: "output" });
                        output_nodes.push(node_name);
                        for (var j = 0; j < output_net_ids[port.bits[i]].length; j++)
                            g.setEdge(output_net_ids[port.bits[i]][j], node_name);
                    }
                }
            }
        }
        function identifyTimingPaths(s, e) {
            if (s == e)
                all_paths.push(current_path.slice().concat(e));     //copy current_path, add ending node and push to all_paths
            else {
                visited[s] = true;
                current_path.push(s);
                for (var i = 0; i < g.outEdges(s).length; i++) {
                    if (visited[g.outEdges(s)[i].w] === false)
                        identifyTimingPaths(g.outEdges(s)[i].w, e)
                }
                visited[s] = false;
                current_path.pop();
            }
        }
        function printPath(path) {
            $(".output").append("--------------------------------------------</br>");
            $(".output").append("Pin&emsp;&emsp;Type</br>");
            for (var i = 0; i < path.length; i++) {
                $(".output").append(path[i] + "&emsp;&emsp;" + g.node(path[i]).type + "</br>");
            }
        }
    };
});