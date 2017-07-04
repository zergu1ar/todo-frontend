(function (window) {
    'use strict';
    (function ($) {
        $.fn.onEnter = function (func) {
            this.bind('keypress', function (e) {
                if (e.keyCode == 13) func.apply(this, [e]);
            });
            return this;
        };
    })(jQuery);

    var wsHost = 'ws://127.0.0.1:8000';
    var authService;
    var $taskTpl = $('.hidden');
    var token = localStorage.getItem('token');
    var userId = localStorage.getItem('userId');

    var conn;
    var Interval;

    function connect(wsHost) {
        conn = new WebSocket(wsHost);
        conn.onopen = function (e) {
            $('#connectionError').hide();
            clearInterval(Interval);
            conn.send(JSON.stringify({'action': 'getList', 'userId': userId, 'token': token}));
        };

        conn.onclose = function (e) {
            $('#connectionError').show();
            Interval = setInterval(function () {
                connect(wsHost)
            }, 5000);
        };

        conn.onmessage = function (e) {
            var response = JSON.parse(e.data);
            switch (response.type) {
                case 'config':
                    return actionConfig(response.data);
                case 'list':
                    return actionList(response.data);
                case 'task':
                    return actionTask(response.data);
                case 'removeTask':
                    return actionRemoveTask(response.data);
                case 'shareList':
                    return actionShareList(response.data);
                case 'shareRemove':
                    return actionRemoveShare(response.data);
            }
            if (response.error === 'Auth error') {
                return $('#auth').show();
            }
        };
    }

    connect(wsHost);

    $('#reconnect').click(function (e) {
        e.preventDefault();
        connect(wsHost)
    });
    $('#auth_form').submit(auth);
    $('#register_form').submit(register);
    $('#add_permission').submit(saveShare);
    $('#logout').click(logout);
    $('.new-todo').onEnter(createTask);
    $('#showAll').click(function (e) {
        setFilter(0, e)
    });
    $('#showActive').click(function (e) {
        setFilter(1, e)
    });
    $('#showCompleted').click(function (e) {
        setFilter(2, e)
    });
    $('.clear-completed').click(removeCompleted);
    $('#showShare').click(openShare);
    $('#share_close').click(closeShare);

    // Auth block begin
    function auth(e) {
        e.preventDefault();
        var form = $('#auth_form');
        var url = authService + 'auth/';
        $.ajax({
            url: url,
            type: 'POST',
            dataType: 'json',
            data: form.serialize(),
            success: function (data) {
                process_reg_answer(data, form);
            }
        });
    }

    function process_reg_answer(data, form) {
        if (!data.error) {
            token = data.response.token;
            userId = data.response.userId;
            localStorage.setItem('token', token);
            localStorage.setItem('userId', userId);
            conn.send(JSON.stringify({
                'action': 'getList',
                'userId': userId,
                'token': token
            }));
            $('#auth').hide();
        } else {
            var error = '';
            $.each(data.error, function (index, value) {
                if (index === 'common') {
                    error += value + '<br>';
                } else {
                    form.find('input[name=' + index + ']').parent().addClass('has-error');
                    value.forEach(function (val) {
                        error += val + '<br>';
                    });
                }
            });
            form.find('.message').html(error);
        }
    }

    function register(e) {
        e.preventDefault();
        var form = $('#register_form');
        var url = authService + 'register/';
        $.ajax({
            url: url,
            type: 'POST',
            dataType: 'json',
            data: form.serialize(),
            success: function (data) {
                process_reg_answer(data, form);
            }
        });
    }

    function logout() {
        var url = authService + 'logout/';
        $.ajax({
            url: url,
            type: 'POST',
            dataType: 'json',
            data: {
                'userId': userId,
                'token': token
            },
            success: function (d) {
                localStorage.removeItem('token');
                localStorage.removeItem('userId');
                $('.todo-list li').remove();
                calculate();
                $('#auth').show()
            }
        });
    }

    // Auth block end

    // Filter funcs begin
    function calculate() {
        var count = $('.todo-list li:visible').length;
        $('.todo-count strong').text(count);
    }

    function setFilter(type, e) {
        e.preventDefault();
        $('.filters a').removeClass('selected');
        var $selector = $('ul.todo-list');
        $selector.find('li').hide();
        switch (type) {
            case 1:
                $selector = $selector.find('li:not(.completed)');
                break;
            case 2:
                $selector = $selector.find('li.completed');
                break;
            default:
                $selector = $selector.find('li');
                break;
        }
        $(this).addClass('selected');
        $selector.show();
        calculate();
    }

    // Filter funcs end

    function actionConfig(obj) {
        authService = obj.userServiceUrl;
    }

    function actionList(obj) {
        obj.Self.forEach(function (el) {
            actionTask(el)
        });
        obj.Shared.forEach(function (el) {
            actionTask(el);
        })
    }

    // Tasks funcs begin
    function removeCompleted() {
        $('li.completed:not(".disabled")').each(function (index) {
            setRemoved(null, $(this).find('label').data('id'));
        });
    }

    function createTask() {
        conn.send(JSON.stringify({
            'action': 'saveTask',
            'name': $('.new-todo').val(),
            'userId': userId,
            'token': token
        }));
        $('.new-todo').val('');
    }

    function actionTask(el) {
        var permission = getPermission(el);
        var tpl = $taskTpl.clone()
            .html()
            .replace(/{label}/g, el.name)
            .replace(/{completed}/g, el.completed == 1 ? 'completed' : '')
            .replace(/{checked}/g, el.completed == 1 ? 'checked' : '')
            .replace(/{id}/g, el.id)
            .replace(/{username}/g, el.ownerId == userId ?
                '' : ('Shared by: ' + el.owner + (permission == 0 ? ', read only' : '')))
            .replace(/{disabled}/g, permission == 0 ? ' disabled' : '');
        if ($('#task_' + el.id).length === 0) {
            if (el.ownerId == userId) {
                $('.todo-list .divider').before(tpl);
            } else {
                $('.todo-list').append(tpl);
            }
        } else {
            $('#task_' + el.id).replaceWith(tpl);
        }
        if (permission == 1) {
            $('#task_' + el.id + ' input[type=checkbox]').change(setCompleted);
            $('#task_' + el.id + ' .destroy').click(setRemoved);
            $('#task_' + el.id + ' label').dblclick(editTask);
            $('#task_' + el.id + ' .edit').onEnter(saveTask);
        }
        calculate();
    }

    function getPermission(el) {
        if (el.ownerId == userId) {
            return 1;
        }
        var permission = 0;
        el.share.forEach(function (share) {
            if (share.userId == userId) {
                permission = share.permission;
                return;
            }
        });
        return permission;
    }

    function setCompleted() {
        conn.send(JSON.stringify({
            'action': 'setComplete',
            'userId': userId,
            'token': token,
            'id': $(this).data('id'),
            'state': $(this).parent().parent().hasClass('completed') ? 0 : 1
        }));
    }

    function setRemoved(e, id) {
        conn.send(JSON.stringify({
            'action': 'removeTask',
            'userId': userId,
            'token': token,
            'id': id ? id : $(this).data('id')
        }));
    }

    function editTask() {
        $(this).parent().hide().parent().find('.edit').show();
    }

    function saveTask() {
        conn.send(JSON.stringify({
            'action': 'saveTask',
            'userId': userId,
            'token': token,
            'id': $(this).data('id'),
            'name': $(this).val(),
            'completed': $(this).parent().hasClass('completed') ? 1 : 0
        }));
    }

    function actionRemoveTask(obj) {
        var $target = $('#task_' + obj.id);
        if ($target.is(':visible')) {
            $target.fadeOut();
            setTimeout(function () {
                $target.remove();
                calculate()
            }, 1000);
        } else {
            $target.remove();
        }
    }

    // Tasks funcs end

    // Share section begin
    function openShare(e) {
        e.preventDefault();
        conn.send(JSON.stringify({
            'action': 'getShare',
            'userId': userId,
            'token': token
        }));
        $('#share').show();
    }

    function closeShare(e) {
        e.preventDefault();
        $('#share').hide();
    }

    function actionShareList(data) {
        if (data.length > 0) {
            data.forEach(function (share) {
                var tpl = $('#shareRow').clone()
                    .html()
                    .replace(/{username}/g, share.username)
                    .replace(/{userId}/g, share.userId)
                    .replace(/{created}/g, share.created)
                    .replace(/{updated}/g, share.updated)
                    .replace(/{changeToPerm}/g, share.permission == 0 ? 1 : 0)
                    .replace(/{permission}/g, share.permission == 0 ? 'read' : 'write')
                    .replace(/{ChangeTo}/g, share.permission == 0 ? 'write' : 'read');
                var $exists = $('#share #share_' + share.userId);
                if ($exists.length === 0) {
                    $('#share tbody').append(tpl);
                } else {
                    $exists.replaceWith(tpl);
                }
                $('#share .no-rows').hide();

                $('#share_' + share.userId + ' .changePerm').click(changePerm);
                $('#share_' + share.userId + ' .removePerm').click(removePerm);
            });
        }
    }

    function changePerm(e) {
        e.preventDefault();
        conn.send(JSON.stringify({
            'permission': $(this).data('permission'),
            'username': $(this).data('username'),
            'userId': userId,
            'token': token,
            'action': 'saveShare'
        }));
    }

    function removePerm(e) {
        e.preventDefault();
        conn.send(JSON.stringify({
            'username': $(this).data('username'),
            'userId': userId,
            'token': token,
            'action': 'removeShare'
        }));
    }

    function saveShare(e) {
        e.preventDefault();
        var form = $('#add_permission');
        conn.send(JSON.stringify({
            'permission': form.find('input[name=permission]').prop('checked') ? 1 : 0,
            'username': form.find('input[name=username]').val(),
            'userId': userId,
            'token': token,
            'action': 'saveShare'
        }));
    }

    function actionRemoveShare(data) {
        $('#share_' + data.userId).remove();
    }

    // EOF
})(window);
